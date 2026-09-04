// Small LSO community patch shown next to each pass: USMC STOVL for the
// Harrier, US Navy for every hook aircraft. Sized to sit inside one table row.

import styles from './page.module.css';
import { SERVICE_BADGE, serviceBranch } from './lsoGrades';

export function ServiceBadge({ aircraftType }: { aircraftType: string | null | undefined }) {
  const badge = SERVICE_BADGE[serviceBranch(aircraftType)];
  // Static asset from /icon (served next to the executable); next/image adds nothing.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.badge} src={badge.src} alt={badge.label} title={badge.label} />;
}
