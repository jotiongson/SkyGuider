import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Dimensions, TouchableOpacity } from 'react-native';
import * as Linking from 'expo-linking';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Magnetometer, Accelerometer } from 'expo-sensors';

// --- 1. FIREBASE CONFIGURATION ---
const baseFirebaseConfig = {
  authDomain: "skyguider.firebaseapp.com",
  projectId: "skyguider",
  storageBucket: "skyguider.firebasestorage.app",
  messagingSenderId: "805246291410",
  appId: "1:805246291410:web:e5317aa3d4b03867308c0b"
};

// --- 2. CELESTIAL CATALOG & MATH ENGINE ---
const CATALOG = [
  { id: 'moon', name: 'The Moon', ra: 14.5, dec: -15.0, mag: -10.0, type: 'Moon', color: '#ffffff' },
  { id: 'polaris', name: 'Polaris', ra: 2.53, dec: 89.26, mag: 2.0, type: 'Star', color: '#ffffcc' },
  { id: 'sirius', name: 'Sirius', ra: 6.75, dec: -16.71, mag: -1.46, type: 'Star', color: '#ffffff' },
  { id: 'betelgeuse', name: 'Betelgeuse', ra: 5.91, dec: 7.4, mag: 0.5, type: 'Star', color: '#ffb380' },
  { id: 'rigel', name: 'Rigel', ra: 5.24, dec: -8.2, mag: 0.12, type: 'Star', color: '#a3c2ff' },
  { id: 'm42', name: 'Orion Nebula', ra: 5.58, dec: -5.39, mag: 4.0, type: 'Nebula', color: '#ff99ff' },
  { id: 'm31', name: 'Andromeda', ra: 0.71, dec: 41.26, mag: 3.4, type: 'Galaxy', color: '#ccccff' }
];

const MathEngine = {
  rad: (deg: number) => deg * (Math.PI / 180),
  deg: (rad: number) => rad * (180 / Math.PI),
  getLST: (lon: number, date = new Date()) => {
    const jd = (date.getTime() / 86400000) + 2440587.5;
    const d = jd - 2451545.0;
    let gmst = 280.46061837 + 360.98564736629 * d;
    return ((gmst + lon) % 360 + 360) % 360;
  },
  getAltAz: (raHours: number, decDeg: number, latDeg: number, lonDeg: number) => {
    const raDeg = raHours * 15;
    let haDeg = (MathEngine.getLST(lonDeg) - raDeg + 360) % 360;
    const lat = MathEngine.rad(latDeg);
    const dec = MathEngine.rad(decDeg);
    const ha = MathEngine.rad(haDeg);
    const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
    const altRad = Math.asin(sinAlt);
    const cosAz = (Math.sin(dec) - Math.sin(altRad) * Math.sin(lat)) / (Math.cos(altRad) * Math.cos(lat));
    let azRad = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    let azDeg = MathEngine.deg(azRad);
    if (Math.sin(ha) > 0) azDeg = 360 - azDeg;
    return { altitude: MathEngine.deg(altRad), azimuth: azDeg };
  }
};

// --- 3. THE NATIVE AR ENGINE COMPONENT ---
function ARCanvas({ user }: { user: User }) {
  const [orientation, setOrientation] = useState({ azimuth: 180, altitude: 0 });
  const [targetId, setTargetId] = useState('moon');
  // Defaulting to Anaheim, CA coordinates for testing
  const location = { lat: 33.8366, lon: -117.9143 }; 
  
  const { width, height } = Dimensions.get('window');
  const cx = width / 2;
  const cy = height / 2;
  const fov = 60; // 60 degree field of view
  const pixelsPerDegree = width / fov;

  useEffect(() => {
    // Poll native sensors at ~30fps for smooth AR without draining battery
    Magnetometer.setUpdateInterval(32);
    Accelerometer.setUpdateInterval(32);

    const magSub = Magnetometer.addListener(data => {
      let angle = Math.atan2(data.y, data.x) * (180 / Math.PI);
      angle = angle >= 0 ? angle : angle + 360;
      setOrientation(prev => ({ ...prev, azimuth: angle }));
    });

    const accSub = Accelerometer.addListener(data => {
      const pitchAngle = Math.atan2(data.y, Math.sqrt(data.x * data.x + data.z * data.z)) * (180 / Math.PI);
      setOrientation(prev => ({ ...prev, altitude: pitchAngle }));
    });

    return () => {
      magSub.remove();
      accSub.remove();
    };
  }, []);

  // Map coordinates to screen pixels
  const mappedObjects = useMemo(() => {
    return CATALOG.map(obj => {
      const { altitude, azimuth } = MathEngine.getAltAz(obj.ra, obj.dec, location.lat, location.lon);
      
      let dAz = azimuth - orientation.azimuth;
      if (dAz > 180) dAz -= 360;
      if (dAz < -180) dAz += 360;
      const dAlt = altitude - orientation.altitude;

      const x = cx + (dAz * pixelsPerDegree);
      const y = cy - (dAlt * pixelsPerDegree);
      const onScreen = (x > -50 && x < width + 50 && y > -50 && y < height + 50);

      return { ...obj, x, y, dAz, dAlt, onScreen };
    });
  }, [orientation.azimuth, orientation.altitude]);

  const target = mappedObjects.find(o => o.id === targetId);
  const targetLocked = target?.onScreen;
  const guideAngle = target ? MathEngine.deg(Math.atan2(target.y - cy, target.x - cx)) : 0;

  return (
    <View style={styles.arContainer}>
      {/* Background */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#020014' }]} />

      {/* Render Stars */}
      {mappedObjects.map(obj => {
        if (!obj.onScreen) return null;
        const size = Math.max(2, 6 - obj.mag);
        return (
          <View key={obj.id} style={{ position: 'absolute', left: obj.x - size, top: obj.y - size }}>
            {/* Star Glow */}
            <View style={{ width: size * 2, height: size * 2, borderRadius: size, backgroundColor: obj.color, shadowColor: obj.color, shadowRadius: 10, shadowOpacity: 1 }} />
            {/* Label */}
            {(obj.mag < 2 || obj.id === targetId) && (
              <Text style={{ color: '#94a3b8', fontSize: 12, position: 'absolute', left: size * 2 + 4, top: -4, width: 100 }}>
                {obj.name}
              </Text>
            )}
            {/* Target Reticle */}
            {obj.id === targetId && (
              <View style={{ position: 'absolute', left: -20 + size, top: -20 + size, width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#22c55e' }} />
            )}
          </View>
        );
      })}

      {/* Off-Screen Guide Arrow */}
      {!targetLocked && target && (
        <View style={{ position: 'absolute', left: cx, top: cy, transform: [{ rotate: `${guideAngle}deg` }] }}>
          <Text style={{ color: '#f59e0b', fontSize: 30, transform: [{ translateX: 120 }] }}>➔</Text>
        </View>
      )}

      {/* HUD & Status Overlay */}
      <View style={styles.hudTop}>
        <Text style={styles.hudTitle}>SkyGuider AR</Text>
        <Text style={styles.hudText}>User: {user.uid.slice(0, 5)}</Text>
      </View>

      <View style={styles.hudBottom}>
        <Text style={targetLocked ? styles.lockedText : styles.searchText}>
          {targetLocked ? `LOCKED: ${target?.name}` : `FINDING: ${target?.name}`}
        </Text>
        <View style={styles.sensorReadout}>
          <Text style={styles.hudText}>AZ: {orientation.azimuth.toFixed(0)}°</Text>
          <Text style={styles.hudText}>ALT: {orientation.altitude.toFixed(0)}°</Text>
        </View>
      </View>
    </View>
  );
}

// --- 4. MAIN AUTHENTICATION WRAPPER ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<string>('Waiting for Magic Link...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleDeepLink = async (event: Linking.EventType) => {
      try {
        const url = event.url;
        setStatus('Link detected. Extracting keys...');
        
        const { queryParams } = Linking.parse(url);
        const obfuscatedKey = queryParams?.key as string;

        if (!obfuscatedKey) throw new Error("No key found in URL");

        setStatus('Decrypting key...');
        const baseKey = obfuscatedKey.slice(0, -5);
        const reversedTail = obfuscatedKey.slice(-5);
        const fixedTail = reversedTail.split('').reverse().join('');
        const validApiKey = baseKey + fixedTail;

        setStatus('Connecting to Firebase...');
        let app;
        if (!getApps().length) {
          app = initializeApp({ ...baseFirebaseConfig, apiKey: validApiKey });
        } else {
          app = getApp();
        }

        const auth = getAuth(app);
        const db = getFirestore(app);

        setStatus('Authenticating user...');
        const userCredential = await signInAnonymously(auth);
        
        setStatus('Setting up user profile...');
        await setDoc(doc(db, 'user_preferences', userCredential.user.uid), {
          id: userCredential.user.uid,
          last_target: 'moon',
          created_at: serverTimestamp()
        }, { merge: true });

        setUser(userCredential.user);
      } catch (err: any) {
        setError(err.message);
        setStatus('Authentication Failed');
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink({ url }); });

    return () => subscription.remove();
  }, []);

  if (user) {
    return <ARCanvas user={user} />;
  }

  return (
    <View style={styles.container}>
      {error ? (
        <View style={styles.card}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <ActivityIndicator size="large" color="#f59e0b" style={{ marginBottom: 20 }} />
          <Text style={styles.title}>SkyGuider Setup</Text>
          <Text style={styles.status}>{status}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020014', alignItems: 'center', justifyContent: 'center', padding: 20 },
  arContainer: { flex: 1, backgroundColor: '#020014', overflow: 'hidden' },
  card: { backgroundColor: '#0f172a', padding: 30, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: '#1e293b', width: '100%' },
  title: { color: '#ffffff', fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  status: { color: '#f59e0b', fontSize: 16, textAlign: 'center' },
  errorIcon: { fontSize: 40, marginBottom: 10 },
  errorText: { color: '#ef4444', fontSize: 16, textAlign: 'center' },
  hudTop: { position: 'absolute', top: 50, left: 20 },
  hudTitle: { color: '#ffffff', fontSize: 20, fontWeight: 'bold' },
  hudText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  hudBottom: { position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  searchText: { color: '#f59e0b', fontSize: 16, fontWeight: 'bold', tracking: 2 },
  lockedText: { color: '#22c55e', fontSize: 16, fontWeight: 'bold', tracking: 2 },
  sensorReadout: { alignItems: 'flex-end' }
});
