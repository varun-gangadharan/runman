/** Display units. Purely presentational — everything is computed in SI. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const SettingsContext = createContext(null);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within a SettingsProvider');
  return context;
}

export function SettingsProvider({ children }) {
  const [units, setUnits] = useState(() => localStorage.getItem('runman_units') ?? 'metric');

  useEffect(() => {
    localStorage.setItem('runman_units', units);
  }, [units]);

  const metric = units === 'metric';

  const convertDistance = useCallback((km) => Number((metric ? km : km * 0.621371).toFixed(1)), [metric]);
  const convertElevation = useCallback((meters) => Math.round(metric ? meters : meters * 3.28084), [metric]);

  /** Seconds per kilometre in, `m:ss` per display unit out. */
  const convertPace = useCallback(
    (secondsPerKm) => {
      const perUnit = metric ? secondsPerKm : secondsPerKm * 1.609344;
      const minutes = Math.floor(perUnit / 60);
      const seconds = Math.round(perUnit % 60);
      return `${minutes}:${String(seconds).padStart(2, '0')}`;
    },
    [metric],
  );

  const value = useMemo(
    () => ({
      units,
      setUnits,
      convertDistance,
      convertElevation,
      convertPace,
      getDistanceUnit: () => (metric ? 'km' : 'mi'),
      getElevationUnit: () => (metric ? 'm' : 'ft'),
      getPaceUnit: () => (metric ? '/km' : '/mi'),
    }),
    [units, metric, convertDistance, convertElevation, convertPace],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
