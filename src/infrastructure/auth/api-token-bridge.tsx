'use client';

import { useEffect } from 'react';
import { useAuthContext } from '@startsimpli/auth';
import { registerTokenProvider } from './index';

export function ApiTokenBridge() {
  const { getAccessToken } = useAuthContext();

  useEffect(() => {
    registerTokenProvider(getAccessToken);
  }, [getAccessToken]);

  return null;
}
