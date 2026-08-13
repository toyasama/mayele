import { useLocalSearchParams } from 'expo-router';
import { PlaceholderPage } from '@/components/PlaceholderPage';
export default function FriendsSection() { const { section } = useLocalSearchParams<{ section: string }>(); return <PlaceholderPage title={section === 'search' ? 'Rechercher un joueur' : section === 'requests' ? 'Demandes d’amis' : 'Défis en cours'} description="La route est prête pour accueillir les appels sociaux de l’API Mayele." />; }
