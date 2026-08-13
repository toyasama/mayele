import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';

export default function Index() {
  const { isSignedIn } = useAuth();
  return <Redirect href={isSignedIn ? '/(tabs)/play' : '/sign-in'} />;
}
