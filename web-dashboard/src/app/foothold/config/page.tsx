"use client";

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from './page.module.css';
import Link from 'next/link';
import schemaData from '@/data/foothold-gui-schema.json';
import { errorMessage } from '@/lib/errors';

type ConfigValue = string | number | boolean | null;
type ConfigValues = Record<string, ConfigValue>;
type MetadataValues = Record<string, { help?: string; choices: string[] }>;

type ConfigResponse = {
    values: ConfigValues;
    metadata: MetadataValues;
};

interface SchemaChoice {
    Display: string;
    Literal?: string;
}

interface SchemaEntry {
    Label?: string;
    Help?: string | null;
    IsEmpty?: boolean;
    ControlType?: string | null;
    Choices?: SchemaChoice[];
}

export default function FootholdConfigPage() {
    const [config, setConfig] = useState<ConfigValues>({});
    const [originalConfig, setOriginalConfig] = useState<ConfigValues>({});
    const [metadata, setMetadata] = useState<MetadataValues>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await apiFetch('/api/foothold/config');
                if (!res.ok) throw new Error('Failed to fetch configuration');
                const data: ConfigResponse = await res.json();
                setConfig(data.values);
                setOriginalConfig(data.values);
                setMetadata(data.metadata || {});
            } catch (e: unknown) {
                setError(errorMessage(e, 'Error loading configuration'));
            } finally {
                setIsLoading(false);
            }
        };
        fetchConfig();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        setSuccessMessage(null);
        try {
            // Only send modified values to avoid unnecessary edits
            const updates: ConfigValues = {};
            for (const key in config) {
                if (config[key] !== originalConfig[key]) {
                    updates[key] = config[key];
                }
            }
            if (Object.keys(updates).length === 0) {
                setSuccessMessage("No changes to save.");
                setIsSaving(false);
                return;
            }

            const res = await apiFetch('/api/foothold/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            if (!res.ok) throw new Error('Failed to save configuration');
            
            setOriginalConfig(config);
            setSuccessMessage("Configuration saved successfully!");
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (e: unknown) {
            setError(errorMessage(e, 'Error saving configuration'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleChange = (key: string, value: ConfigValue) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    if (isLoading) return <div className={styles.loading}>Loading Configuration...</div>;

    const entries = schemaData.Entries as Record<string, SchemaEntry>;
    const categoryOrder = schemaData.CategoryOrder;
    const categoryLayout = schemaData.CategoryLayouts as Record<string, { Items: string[] }>;
    
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h1 className={styles.title}>Foothold Configuration</h1>
                    <p className={styles.subtitle}>Manage Foothold options directly.</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <Link href="/foothold" className={styles.navBtn}>
                        ← Back to Foothold
                    </Link>
                    <button 
                        className={styles.saveBtn} 
                        onClick={handleSave} 
                        disabled={isSaving || JSON.stringify(config) === JSON.stringify(originalConfig)}
                    >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}
            {successMessage && <div style={{ background: 'rgba(0, 255, 0, 0.1)', color: 'var(--success)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--success)' }}>{successMessage}</div>}

            <div className={styles.formGrid}>
                {categoryOrder.map((catName) => {
                    const category = categoryLayout[catName];
                    if (!category || !category.Items) return null;
                    
                    return (
                        <div key={catName} className={styles.categorySection} style={{ gridColumn: '1 / -1', marginBottom: '2rem' }}>
                            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>{catName}</h2>
                            <div className={styles.formGrid}>
                                {category.Items.map((key: string) => {
                                    const meta = entries[key] || { Label: key, IsEmpty: false };
                                    if (meta.IsEmpty) return null;
                                    
                                    const isArrayField = config[`${key}.1`] !== undefined && config[`${key}.2`] !== undefined;
                                    
                                    const dynamicMeta = metadata[key] || metadata[`${key}.1`] || metadata[key.split('.')[0]] || { help: '', choices: [] };
                                    const helpText = meta.Help || dynamicMeta.help;
                                    
                                    // Combine schema choices with dynamic choices
                                    const schemaChoices = meta.Choices ?? [];
                                    const hasSchemaChoices = schemaChoices.length > 0;
                                    const choices = hasSchemaChoices ? schemaChoices.map((c) => {
                                        return c.Literal ? c.Literal.replace(/^"|"$/g, '') : c.Display;
                                    }) : dynamicMeta.choices;
                                    
                                    const hasChoices = choices && choices.length > 0;
                                    
                                    const tableKeys = Object.keys(config).filter(k => k.startsWith(`${key}.`) && config[k] !== null);
                                    const isDictionaryTable = config[key] === undefined && tableKeys.length > 0 && !isArrayField;
                                    
                                    if (isDictionaryTable) {
                                        return (
                                            <div key={key} className={styles.fieldGroup} style={{ gridColumn: '1 / -1' }}>
                                                <div className={styles.fieldLabel}>{meta.Label || key}</div>
                                                {helpText && <div className={styles.fieldHelp} style={{ whiteSpace: 'pre-wrap' }}>{helpText}</div>}
                                                <div style={{ marginTop: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '4px' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                                                <th style={{ textAlign: 'left', padding: '0.5rem', color: '#94a3b8' }}>Item</th>
                                                                <th style={{ textAlign: 'left', padding: '0.5rem', color: '#94a3b8' }}>Value</th>
                                                                <th style={{ textAlign: 'right', padding: '0.5rem', color: '#94a3b8' }}>Actions</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {tableKeys.map((tKey) => {
                                                                const subKey = tKey.substring(key.length + 1);
                                                                return (
                                                                    <tr key={tKey} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                                        <td style={{ padding: '0.5rem' }}>{subKey}</td>
                                                                        <td style={{ padding: '0.5rem' }}>
                                                                            <input
                                                                                type={typeof config[tKey] === 'number' ? 'number' : 'text'}
                                                                                className={styles.input}
                                                                                value={String(config[tKey] ?? '')}
                                                                                onChange={(e) => {
                                                                                    const v = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                                                                                    handleChange(tKey, v);
                                                                                }}
                                                                            />
                                                                        </td>
                                                                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                                                                            <button
                                                                                onClick={() => handleChange(tKey, null)}
                                                                                style={{ background: 'rgba(255,0,0,0.1)', color: '#ef4444', border: '1px solid rgba(255,0,0,0.2)', borderRadius: '4px', padding: '0.25rem 0.5rem', cursor: 'pointer' }}
                                                                            >
                                                                                Remove
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <input 
                                                            id={`newKey_${key}`} 
                                                            type="text" 
                                                            placeholder="New Item Name" 
                                                            className={styles.input} 
                                                            style={{ width: '200px' }} 
                                                        />
                                                        <input 
                                                            id={`newVal_${key}`} 
                                                            type="number" 
                                                            placeholder="Value" 
                                                            className={styles.input} 
                                                            style={{ width: '150px' }} 
                                                        />
                                                        <button 
                                                            className={styles.saveBtn} 
                                                            style={{ padding: '0.5rem 1rem' }}
                                                            onClick={() => {
                                                                const kInput = document.getElementById(`newKey_${key}`) as HTMLInputElement;
                                                                const vInput = document.getElementById(`newVal_${key}`) as HTMLInputElement;
                                                                if (kInput.value && vInput.value) {
                                                                    handleChange(`${key}.${kInput.value}`, parseFloat(vInput.value));
                                                                    kInput.value = '';
                                                                    vInput.value = '';
                                                                }
                                                            }}
                                                        >
                                                            Add Row
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    
                                    if (isArrayField) {
                                        return (
                                            <div key={key} className={styles.fieldGroup}>
                                                <div className={styles.fieldLabel}>{meta.Label || key}</div>
                                                {helpText && <div className={styles.fieldHelp}>{helpText}</div>}
                                                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>RED</label>
                                                        <input 
                                                            type="number" 
                                                            className={styles.input} 
                                                            style={{ width: '100px' }}
                                                            value={String(config[`${key}.1`] ?? '')}
                                                            onChange={(e) => handleChange(`${key}.1`, parseFloat(e.target.value))} 
                                                        />
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>BLUE</label>
                                                        <input 
                                                            type="number" 
                                                            className={styles.input} 
                                                            style={{ width: '100px' }}
                                                            value={String(config[`${key}.2`] ?? '')}
                                                            onChange={(e) => handleChange(`${key}.2`, parseFloat(e.target.value))} 
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    
                                    const value = config[key] !== undefined ? config[key] : '';
                                    const isBool = typeof value === 'boolean' || meta.ControlType === 'checkbox';
                                    const isNumber = typeof value === 'number';
                                    
                                    return (
                                        <div key={key} className={styles.fieldGroup}>
                                            <div className={styles.fieldLabel}>{meta.Label || key}</div>
                                            {helpText && <div className={styles.fieldHelp} style={{ whiteSpace: 'pre-wrap' }}>{helpText}</div>}
                                            
                                            {hasChoices || meta.ControlType === 'dropdown' ? (
                                                <select 
                                                    className={styles.input}
                                                    value={String(value)}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        if (v === 'true') handleChange(key, true);
                                                        else if (v === 'false') handleChange(key, false);
                                                        else if (isNumber) handleChange(key, parseFloat(v));
                                                        else handleChange(key, v);
                                                    }}
                                                >
                                                    <option value="" disabled>Select an option</option>
                                                    {choices.map((choice: string, idx: number) => (
                                                        <option key={idx} value={choice}>
                                                            {choice}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : isBool ? (
                                                <input 
                                                    type="checkbox"
                                                    className={styles.checkbox}
                                                    checked={Boolean(value)}
                                                    onChange={(e) => handleChange(key, e.target.checked)}
                                                />
                                            ) : isNumber ? (
                                                <input 
                                                    type="number"
                                                    className={styles.input}
                                                    value={String(value ?? '')}
                                                    onChange={(e) => handleChange(key, parseFloat(e.target.value))}
                                                />
                                            ) : (
                                                <input 
                                                    type="text"
                                                    className={styles.input}
                                                    value={String(value ?? '')}
                                                    onChange={(e) => handleChange(key, e.target.value)}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
