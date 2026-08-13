import { useLocalSearchParams } from 'expo-router';
import { PlaceholderPage } from '@/components/PlaceholderPage';
export default function SpaceSection() { const { section } = useLocalSearchParams<{ section: string }>(); return <PlaceholderPage title={section === 'profile' ? 'Mon profil' : section === 'missions' ? 'Missions' : section === 'badges' ? 'Badges' : 'Progression'} description="Cette sous-page est raccordée à la navigation et sera la prochaine brique fonctionnelle." />; }
