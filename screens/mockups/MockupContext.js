import { createContext, useContext, useState } from 'react';

const MockupCtx = createContext(null);

export function MockupContextProvider({ children }) {
  const [profile, setProfile] = useState({
    name: '',
    memorizedJuz: [],       // array of juz numbers fully memorized
    memorizedPartial: {},   // { 'juzNum-surahNum': ayahUpTo }
    sessionMinutes: 30,
    gender: null,
    notificationsEnabled: false,
    reminderTime: null,     // Date
  });
  const [sessionMistakes, setSessionMistakes] = useState([]);

  const updateProfile = (updates) => setProfile((p) => ({ ...p, ...updates }));
  const addMistake = (m) => setSessionMistakes((prev) => [...prev, m]);
  const clearSession = () => setSessionMistakes([]);

  return (
    <MockupCtx.Provider value={{ profile, updateProfile, sessionMistakes, addMistake, clearSession }}>
      {children}
    </MockupCtx.Provider>
  );
}

export const useMockup = () => useContext(MockupCtx);
