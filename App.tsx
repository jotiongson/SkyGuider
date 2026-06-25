import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import * as Linking from 'expo-linking';
import { Magnetometer, Accelerometer } from 'expo-sensors';

export default function App() {
  const [authData, setAuthData] = useState<string | null>(null);

  // Deep Link Listener for Supabase Auth
  useEffect(() => {
    const handleUrl = (event: Linking.EventType) => {
      const { url } = event;
      // Reverse-key parsing logic will go here
      setAuthData(url);
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>SkyGuide AR Core Initialized</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020014',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontFamily: 'monospace',
  },
});
