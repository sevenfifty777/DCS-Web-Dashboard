import styles from "./page.module.css";
import ServerStatus from "@/components/ServerStatus";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>DCS Dashboard</h1>
      <p>Server management interface.</p>
      
      <div className={styles.dashboardGrid}>
        <ServerStatus />
      </div>
    </main>
  );
}
