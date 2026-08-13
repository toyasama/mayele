import { useAuth } from '@clerk/expo';
import { useCallback, useEffect, useRef } from 'react';

export function useStableToken() {
  const { getToken } = useAuth();
  const ref = useRef(getToken);
  useEffect(() => { ref.current = getToken; });
  return useCallback(() => ref.current(), []);
}
