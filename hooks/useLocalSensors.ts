import { useState, useCallback } from 'react';
import { GardenEvent } from '../types';

interface UseLocalSensorsProps {
  onGardenEvent?: (event: GardenEvent) => void;
}

export const useLocalSensors = ({ onGardenEvent }: UseLocalSensorsProps) => {
  const [isActive, setIsActive] = useState(false);

  const startSensors = useCallback(async () => {
    // Only logic needed now is state management, as camera is handled in LiveSession
    setIsActive(true);
  }, []);

  const stopSensors = useCallback(() => {
    setIsActive(false);
  }, []);

  return {
    startSensors,
    stopSensors,
    isActive,
    audioVolume: 0 // Mocked since we removed audio
  };
};