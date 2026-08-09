"use client";

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/lib/api';

const DynamicCSARMap = dynamic(() => import('../../components/CSARMap'), { 
    ssr: false,
    loading: () => (
        <div className="w-full h-[400px] flex items-center justify-center bg-gray-900 border border-gray-800 rounded-2xl">
            <div className="animate-pulse text-orange-500 font-mono text-sm uppercase tracking-widest">Initializing CSAR Uplink...</div>
        </div>
    )
});

const DynamicZoneDetailsMap = dynamic(() => import('../../components/ZoneDetailsMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-[500px] flex items-center justify-center bg-gray-900 border border-gray-800 rounded-2xl animate-pulse text-cyan-500 font-mono text-sm uppercase tracking-widest">Loading Zone Map...</div>
});

const DynamicRedAttacksMap = dynamic(() => import('../../components/RedAttacksMap'), { 
    ssr: false,
    loading: () => <div className="w-full h-[500px] flex items-center justify-center bg-gray-900 border border-gray-800 rounded-2xl animate-pulse text-red-500 font-mono text-sm uppercase tracking-widest">Loading Tactical Map...</div>
});

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
    lat: number;
    lon: number;
    alt: number;
    timestamp: number;
}

interface FootholdAttack {
    group_name: string;
    origin_zone: string;
    target_zone: string;
    side: number;
    mission_type: string;
    alive_count: number;
    unit_types: string[];
}

interface FootholdZone {
    name: string;
    side: number;
    level: number;
    lat: number;
    lon: number;
    units: string[];
}

interface FootholdData {
    players: FootholdPlayer[];
    missions: FootholdMission[];
    ejected_pilots: FootholdEjectedPilot[];
    zones: FootholdZone[];
    attacks: FootholdAttack[];
}

export default function FootholdPage() {
    const [data, setData] = useState<FootholdData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'missions' | 'csar' | 'economy' | 'zones' | 'attacks'>('overview');

    const fetchData = async () => {
        try {
            const res = await apiFetch('/api/foothold');
            if (!res.ok) throw new Error('Network response was not ok');
            const data = await res.json();
            setData(data);
            setError(null);
        } catch (e: any) {
            setError(e.message || 'Failed to load Foothold data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // refresh every 10s
        return () => clearInterval(interval);
    }, []);

    if (isLoading && !data) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-950">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400" />
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="p-8 text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg m-8">
                <h3 className="text-xl font-bold mb-2">Error Loading Data</h3>
                <p>{error}</p>
            </div>
        );
    }

    if (!data) return null;

    const blueZones = data.zones.filter(z => z.side === 2).length;
    const redZones = data.zones.filter(z => z.side === 1).length;
    const activeMissions = data.missions.filter(m => m.is_running);

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-8 flex gap-8 animate-in fade-in duration-500">
            
            {/* Left Sub-navigation Panel */}
            <div className="w-64 shrink-0 flex flex-col gap-2">
                <div className="mb-8">
                    <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 uppercase tracking-wider mb-2">
                        Foothold
                    </h1>
                    <p className="text-gray-400 text-sm">Campaign Telemetry</p>
                </div>

                <nav className="flex flex-col gap-2">
                    <button 
                        onClick={() => setActiveTab('overview')}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-left ${activeTab === 'overview' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border border-transparent'}`}
                    >
                        Overview
                    </button>
                    <button 
                        onClick={() => setActiveTab('missions')}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-left ${activeTab === 'missions' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border border-transparent'}`}
                    >
                        Active Missions
                        {activeMissions.length > 0 && (
                            <span className="ml-auto bg-yellow-500/20 text-yellow-500 py-0.5 px-2 rounded-full text-xs font-bold">{activeMissions.length}</span>
                        )}
                    </button>
                    <button 
                        onClick={() => setActiveTab('csar')}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-left ${activeTab === 'csar' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border border-transparent'}`}
                    >
                        CSAR Board
                        {data.ejected_pilots.length > 0 && (
                            <span className="ml-auto bg-orange-500/20 text-orange-500 py-0.5 px-2 rounded-full text-xs font-bold">{data.ejected_pilots.length}</span>
                        )}
                    </button>
                    <button 
                        onClick={() => setActiveTab('zones')}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-left ${activeTab === 'zones' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border border-transparent'}`}
                    >
                        Zone Details
                    </button>
                    <button 
                        onClick={() => setActiveTab('attacks')}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-left ${activeTab === 'attacks' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border border-transparent'}`}
                    >
                        Live AI Activity
                        {data.attacks && data.attacks.length > 0 && (
                            <span className="ml-auto bg-red-500/20 text-red-500 py-0.5 px-2 rounded-full text-xs font-bold">{data.attacks.length}</span>
                        )}
                    </button>
                    <button 
                        onClick={() => setActiveTab('economy')}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-left ${activeTab === 'economy' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border border-transparent'}`}
                    >
                        Global Economy
                    </button>
                </nav>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-w-0">
                
                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="bg-gray-900/50 backdrop-blur-md p-6 rounded-2xl border border-gray-800 shadow-xl relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400 font-bold text-xl flex items-center justify-center w-12 h-12">
                                    B
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-medium">Blue Zones</p>
                                    <h3 className="text-3xl font-bold text-white">{blueZones}</h3>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-900/50 backdrop-blur-md p-6 rounded-2xl border border-gray-800 shadow-xl relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-red-500/20 rounded-xl text-red-400 font-bold text-xl flex items-center justify-center w-12 h-12">
                                    R
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-medium">Red Zones</p>
                                    <h3 className="text-3xl font-bold text-white">{redZones}</h3>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-900/50 backdrop-blur-md p-6 rounded-2xl border border-gray-800 shadow-xl relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-yellow-500/20 rounded-xl text-yellow-400 font-bold text-xl flex items-center justify-center w-12 h-12">
                                    M
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-medium">Active Missions</p>
                                    <h3 className="text-3xl font-bold text-white">{activeMissions.length}</h3>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-900/50 backdrop-blur-md p-6 rounded-2xl border border-gray-800 shadow-xl relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-orange-500/20 rounded-xl text-orange-400 font-bold text-xl flex items-center justify-center w-12 h-12">
                                    P
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-medium">Ejected Pilots (CSAR)</p>
                                    <h3 className="text-3xl font-bold text-white">{data.ejected_pilots.length}</h3>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* MISSIONS TAB */}
                {activeTab === 'missions' && (
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-3xl p-8 shadow-2xl backdrop-blur-sm flex flex-col min-h-[500px] animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3 mb-8">
                            <h2 className="text-3xl font-bold text-white">Active Missions</h2>
                        </div>
                        <div className="flex-1 space-y-4">
                            {activeMissions.length === 0 ? (
                                <p className="text-gray-500 text-lg italic text-center mt-12">No active missions found.</p>
                            ) : (
                                activeMissions.map((mission, idx) => (
                                    <div key={idx} className="p-6 bg-gray-800/40 rounded-xl border border-gray-700/50 hover:border-yellow-500/30 transition-colors group relative overflow-hidden">
                                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-yellow-500/50 group-hover:bg-yellow-400 transition-colors" />
                                        <h4 className="text-xl font-bold text-gray-100 mb-3 pl-3">{mission.title}</h4>
                                        <p className="text-base text-gray-400 whitespace-pre-wrap pl-3 leading-relaxed">{mission.description}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* CSAR TAB */}
                {activeTab === 'csar' && (
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-3xl p-8 shadow-2xl backdrop-blur-sm flex flex-col min-h-[500px] animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <h2 className="text-3xl font-bold text-white">CSAR Board</h2>
                            </div>
                        </div>

                        <div className="mb-8">
                            <DynamicCSARMap pilots={data.ejected_pilots} />
                        </div>
                        <div className="flex-1">
                            {data.ejected_pilots.length === 0 ? (
                                <p className="text-gray-500 text-lg italic text-center mt-12">No pilots need rescue right now.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-gray-800 text-gray-500 uppercase text-xs tracking-wider">
                                                <th className="pb-4 px-4 text-base">Pilot</th>
                                                <th className="pb-4 px-4 text-base">Coalition</th>
                                                <th className="pb-4 px-4 text-right text-base">Coordinates</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-800/50">
                                            {data.ejected_pilots.map((p, idx) => (
                                                <tr key={idx} className="hover:bg-gray-800/30 transition-colors group">
                                                    <td className="py-5 px-4 font-semibold text-gray-200 text-lg">
                                                        {p.player_name || "Unknown"}
                                                    </td>
                                                    <td className="py-5 px-4">
                                                        <span className={`px-3 py-1.5 text-sm font-bold rounded-full border ${p.coalition === 2 ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                                                            {p.coalition === 2 ? 'BLUE' : 'RED'}
                                                        </span>
                                                    </td>
                                                    <td className="py-5 px-4 text-right font-mono text-base text-gray-400">
                                                        {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ECONOMY TAB */}
                {activeTab === 'economy' && (
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-3xl p-8 shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3 mb-8">
                            <h2 className="text-3xl font-bold text-white">Global Player Economy</h2>
                        </div>
        
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-800 text-gray-500 text-xs font-semibold uppercase tracking-wider">
                                        <th className="pb-4 px-4 w-16">Rank</th>
                                        <th className="pb-4 px-4 min-w-[200px]">Pilot</th>
                                        <th className="pb-4 px-4 text-right text-green-400 min-w-[100px]">Credits</th>
                                        <th className="pb-4 px-4 text-right min-w-[100px]">Points</th>
                                        <th className="pb-4 px-4 text-right text-gray-600 min-w-[100px]">Spent</th>
                                        <th className="pb-4 px-4 text-center min-w-[120px]">Air / Helo</th>
                                        <th className="pb-4 px-4 text-center min-w-[160px]">GND / SAM / INF</th>
                                        <th className="pb-4 px-4 text-center text-red-400 min-w-[80px]">Deaths</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800/50 text-sm">
                                    {data.players.slice(0, 50).map((player, idx) => (
                                        <tr key={idx} className="hover:bg-gray-800/30 transition-colors group">
                                            <td className="py-4 px-4 text-gray-500 font-mono">#{idx + 1}</td>
                                            <td className="py-4 px-4 font-semibold text-gray-200">
                                                {player.name}
                                            </td>
                                            <td className="py-4 px-4 text-right font-bold text-green-400">
                                                ${player.credits.toLocaleString()}
                                            </td>
                                            <td className="py-4 px-4 text-right font-medium text-blue-300">
                                                {player.points}
                                            </td>
                                            <td className="py-4 px-4 text-right font-medium text-gray-500">
                                                {player.points_spent}
                                            </td>
                                            <td className="py-4 px-4 text-center text-gray-400">
                                                <span className="text-gray-300">{player.kills_air}</span> / <span>{player.kills_helo}</span>
                                            </td>
                                            <td className="py-4 px-4 text-center text-gray-400">
                                                <span className="text-gray-300">{player.kills_ground}</span> / <span>{player.kills_sam}</span> / <span>{player.kills_infantry}</span>
                                            </td>
                                            <td className="py-4 px-4 text-center font-bold text-red-400/80 group-hover:text-red-400 transition-colors">
                                                {player.deaths}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {data.players.length > 50 && (
                                <div className="mt-6 text-center text-sm text-gray-500 pb-2">
                                    Showing top 50 of {data.players.length} players.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ZONES TAB */}
                {activeTab === 'zones' && (
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-3xl p-8 shadow-2xl backdrop-blur-sm flex flex-col min-h-[500px] animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3 mb-8">
                            <h2 className="text-3xl font-bold text-white">Zone Details</h2>
                        </div>
                        <div className="mb-8">
                            <DynamicZoneDetailsMap zones={data.zones} />
                        </div>
                    </div>
                )}

                {/* ATTACKS TAB */}
                {activeTab === 'attacks' && (
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-3xl p-8 shadow-2xl backdrop-blur-sm flex flex-col min-h-[500px] animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3 mb-8">
                            <h2 className="text-3xl font-bold text-white">Live AI Activity</h2>
                        </div>
                        <div className="mb-8">
                            <DynamicRedAttacksMap attacks={data.attacks || []} zones={data.zones} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
