"use client";

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from './page.module.css';
import { errorMessage } from '@/lib/errors';

interface FootholdPlayer {
    name: string;
    credits: number;
    points: number;
    points_spent: number;
    kills_air: number;
    kills_helo: number;
    kills_sam: number;
    kills_ground: number;
    kills_infantry: number;
    deaths: number;
}

interface FootholdMission {
    id: number;
    title: string;
    description: string;
    is_running: boolean;
}

interface FootholdEjectedPilot {
    id: number;
    coalition: number;
    player_name: string;
}

interface FootholdZone {
    name: string;
    side: number;
    level: number;
}

interface FootholdData {
    players: FootholdPlayer[];
    missions: FootholdMission[];
    ejected_pilots: FootholdEjectedPilot[];
    zones: FootholdZone[];
}

export default function FootholdPage() {
    const [data, setData] = useState<FootholdData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'missions' | 'economy'>('overview');

    const fetchData = async () => {
        try {
            const res = await apiFetch('/api/foothold');
            if (!res.ok) throw new Error('Network response was not ok');
            const data = await res.json();
            setData(data);
            setError(null);
        } catch (e: unknown) {
            setError(errorMessage(e, 'Failed to load Foothold data'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const initial = setTimeout(fetchData, 0);
        const interval = setInterval(fetchData, 10000);
        return () => {
            clearTimeout(initial);
            clearInterval(interval);
        };
    }, []);

    if (isLoading && !data) return <div className={styles.loading}>Loading Foothold Data...</div>;
    if (error && !data) return <div className={styles.error}>Error Loading Data: {error}</div>;
    if (!data) return null;

    const blueZones = data.zones.filter(z => z.side === 2).length;
    const redZones = data.zones.filter(z => z.side === 1).length;
    const activeMissions = data.missions.filter(m => m.is_running);

    return (
        <div className={styles.container}>
            {/* Left Sub-navigation Panel */}
            <div className={styles.sidebar}>
                <div className={styles.title}>
                    <h1>Foothold</h1>
                    <p>Campaign Telemetry</p>
                </div>

                <nav className={styles.nav}>
                    <button 
                        onClick={() => setActiveTab('overview')}
                        className={`nav-btn ${styles.navBtn} ${activeTab === 'overview' ? styles.navBtnActive : ''}`}
                    >
                        <span>Overview</span>
                    </button>
                    <button 
                        onClick={() => setActiveTab('missions')}
                        className={`nav-btn ${styles.navBtn} ${activeTab === 'missions' ? styles.navBtnActive : ''}`}
                    >
                        <span>Active Missions</span>
                        {activeMissions.length > 0 && <span className={styles.badge}>{activeMissions.length}</span>}
                    </button>
                    <button 
                        onClick={() => setActiveTab('economy')}
                        className={`nav-btn ${styles.navBtn} ${activeTab === 'economy' ? styles.navBtnActive : ''}`}
                    >
                        <span>Global Economy</span>
                    </button>
                    <a 
                        href="/foothold/config"
                        className={`nav-btn ${styles.navBtn}`}
                        style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.1)' }}
                    >
                        <span>⚙️ Configuration</span>
                    </a>
                </nav>
            </div>

            {/* Main Content Area */}
            <div className={styles.content}>
                
                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div className={styles.grid}>
                        <div className={styles.statCard}>
                            <div className={styles.statIcon} style={{color: '#00ccff', background: 'rgba(0, 204, 255, 0.1)'}}>B</div>
                            <div>
                                <div className={styles.statLabel}>Blue Zones</div>
                                <div className={styles.statValue}>{blueZones}</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statIcon} style={{color: '#ff4444', background: 'rgba(255, 68, 68, 0.1)'}}>R</div>
                            <div>
                                <div className={styles.statLabel}>Red Zones</div>
                                <div className={styles.statValue}>{redZones}</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statIcon} style={{color: '#ffaa00', background: 'rgba(255, 170, 0, 0.1)'}}>M</div>
                            <div>
                                <div className={styles.statLabel}>Active Missions</div>
                                <div className={styles.statValue}>{activeMissions.length}</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statIcon} style={{color: '#ff8800', background: 'rgba(255, 136, 0, 0.1)'}}>P</div>
                            <div>
                                <div className={styles.statLabel}>Ejected Pilots</div>
                                <div className={styles.statValue}>{data.ejected_pilots.length}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* MISSIONS TAB */}
                {activeTab === 'missions' && (
                    <div className={styles.panel}>
                        <h2 className={styles.panelTitle}>Active Missions</h2>
                        <div style={{ flex: 1 }}>
                            {activeMissions.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>No active missions found.</p>
                            ) : (
                                activeMissions.map((mission, idx) => (
                                    <div key={idx} className={styles.missionCard}>
                                        <h4>{mission.title}</h4>
                                        <p>{mission.description}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* ECONOMY TAB */}
                {activeTab === 'economy' && (
                    <div className={styles.panel}>
                        <h2 className={styles.panelTitle}>Global Player Economy</h2>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Rank</th>
                                        <th>Pilot</th>
                                        <th style={{ textAlign: 'right', color: 'var(--success)' }}>Credits</th>
                                        <th style={{ textAlign: 'right' }}>Points</th>
                                        <th style={{ textAlign: 'right' }}>Spent</th>
                                        <th style={{ textAlign: 'center' }}>Air / Helo</th>
                                        <th style={{ textAlign: 'center' }}>Gnd / Sam / Inf</th>
                                        <th style={{ textAlign: 'center', color: 'var(--danger)' }}>Deaths</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.players.slice(0, 50).map((player, idx) => (
                                        <tr key={idx}>
                                            <td style={{ fontFamily: 'var(--font-mono)' }}>#{idx + 1}</td>
                                            <td style={{ fontWeight: 'bold' }}>{player.name}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 'bold' }}>${player.credits.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--primary)' }}>{player.points}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{player.points_spent}</td>
                                            <td style={{ textAlign: 'center' }}>{player.kills_air} / {player.kills_helo}</td>
                                            <td style={{ textAlign: 'center' }}>{player.kills_ground} / {player.kills_sam} / {player.kills_infantry}</td>
                                            <td style={{ textAlign: 'center', color: 'var(--danger)' }}>{player.deaths}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {data.players.length > 50 && (
                                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                    Showing top 50 of {data.players.length} players.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
