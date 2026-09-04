// Legend under the LSO page titles: the two LSO communities whose patches
// mark each pass in the table.

import styles from './page.module.css';
import { SERVICE_BADGE } from './lsoGrades';

export function LsoLegend() {
  return (
    <div className={styles.legend} aria-label="LSO communities">
      <figure className={styles.legendItem}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SERVICE_BADGE.usn.src} alt="" />
        <figcaption>U.S. Navy LSO</figcaption>
      </figure>
      <figure className={styles.legendItem}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SERVICE_BADGE.usmc.src} alt="" />
        <figcaption>USMC LSO</figcaption>
      </figure>
    </div>
  );
}
