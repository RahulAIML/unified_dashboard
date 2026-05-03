'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Upload, RotateCcw, Check, Save, Palette, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { DashboardHeader } from '@/components/DashboardHeader'
import { useClientBrand } from '@/lib/hooks/useClientBrand'
import { cn } from '@/lib/utils'
import { DEFAULT_BRANDING_SETTINGS, type BrandingSettings } from '@/lib/branding'

// ── Theme presets ─────────────────────────────────────────────────────────────

const PRESETS: Array<{
  id:          string
  name:        string
  description: string
  settings:    BrandingSettings
}> = [
  {
    id:          'rolplay',
    name:        'Rolplay Default',
    description: 'Red & blue brand palette',
    settings:    DEFAULT_BRANDING_SETTINGS,
  },
  {
    id:          'corporate-blue',
    name:        'Corporate Blue',
    description: 'Professional blue theme',
    settings: {
      logo_url:        null,
      primary_color:   '#2563EB',
      secondary_color: '#1E3A5F',
      accent_color:    '#0EA5E9',
    },
  },
  {
    id:          'modern-teal',
    name:        'Modern Teal',
    description: 'Fresh teal & dark slate',
    settings: {
      logo_url:        null,
      primary_color:   '#0D9488',
      secondary_color: '#0F172A',
      accent_color:    '#38BDF8',
    },
  },
  {
    id:          'executive-purple',
    name:        'Executive Purple',
    description: 'Premium deep purple',
    settings: {
      logo_url:        null,
      primary_color:   '#7C3AED',
      secondary_color: '#1E1B4B',
      accent_color:    '#A78BFA',
    },
  },
  {
    id:          'emerald',
    name:        'Emerald Growth',
    description: 'Clean green performance',
    settings: {
      logo_url:        null,
      primary_color:   '#059669',
      secondary_color: '#064E3B',
      accent_color:    '#34D399',
    },
  },
  {
    id:          'amber',
    name:        'Amber Professional',
    description: 'Warm amber & deep brown',
    settings: {
      logo_url:        null,
      primary_color:   '#D97706',
      secondary_color: '#292524',
      accent_color:    '#FCD34D',
    },
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const brand       = useClientBrand()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Local draft state (doesn't auto-save)
  const [draft,     setDraft]     = useState<BrandingSettings | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [copied,    setCopied]    = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activePreset, setActivePreset] = useState<string | null>(null)

  // Initialise draft from brand once loaded
  useEffect(() => {
    if (!brand.isLoading && draft === null) {
      setDraft({
        logo_url:        brand.logo,
        primary_color:   brand.primaryColor,
        secondary_color: brand.secondaryColor,
        accent_color:    brand.accentColor,
      })
    }
  }, [brand.isLoading, brand.logo, brand.primaryColor, brand.secondaryColor, brand.accentColor, draft])

  const current = draft ?? {
    logo_url:        brand.logo,
    primary_color:   brand.primaryColor,
    secondary_color: brand.secondaryColor,
    accent_color:    brand.accentColor,
  }

  const hasUnsaved = draft !== null && (
    draft.primary_color   !== brand.primaryColor   ||
    draft.secondary_color !== brand.secondaryColor ||
    draft.accent_color    !== brand.accentColor    ||
    draft.logo_url        !== brand.logo
  )

  // ── Actions ──────────────────────────────────────────────────────────────────

  const doSave = useCallback(async (settings: BrandingSettings) => {
    setSaving(true)
    try {
      await brand.saveBranding(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }, [brand])

  const handleSave = () => void doSave(current)

  const handleReset = () => {
    setDraft(DEFAULT_BRANDING_SETTINGS)
    setActivePreset('rolplay')
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = async (event) => {
        const result = event.target?.result
        if (typeof result === 'string') {
          const next = { ...current, logo_url: result }
          setDraft(next)
          await doSave(next)   // logo upload saves immediately
        }
      }
      reader.readAsDataURL(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const applyPreset = (preset: typeof PRESETS[number]) => {
    const next = {
      ...preset.settings,
      logo_url: current.logo_url,   // keep existing logo
    }
    setDraft(next)
    setActivePreset(preset.id)
  }

  const updateColor = (field: keyof BrandingSettings, value: string) => {
    setDraft(prev => ({ ...(prev ?? current), [field]: value }))
    setActivePreset(null)
  }

  const copyToClipboard = (color: string, key: string) => {
    navigator.clipboard.writeText(color)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (brand.isLoading) {
    return (
      <div className="min-h-screen">
        <DashboardHeader title="Settings" subtitle="Customize your dashboard branding" />
        <div className="p-6 animate-pulse space-y-4 max-w-2xl">
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <DashboardHeader title="Settings" subtitle="Customize your dashboard branding" />

      <div className="px-4 sm:px-6 py-6 max-w-2xl space-y-6">

        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="h-[3px] bg-gradient-to-r from-primary to-accent" />
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-4">Logo</h2>
            <div className="flex items-center gap-5 flex-wrap">
              {/* Preview */}
              <div className="shrink-0 w-36 h-16 rounded-xl border border-border bg-muted/40 flex items-center justify-center overflow-hidden p-2">
                {current.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={current.logo_url}
                    alt="Logo preview"
                    className="max-h-10 max-w-[120px] w-auto h-auto object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </div>

              <div className="flex-1 min-w-[180px] space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  <Upload className="w-4 h-4" />
                  {saving ? 'Uploading…' : 'Upload Logo'}
                </button>
                <p className="text-xs text-muted-foreground">PNG, JPG, or WebP recommended</p>
                {current.logo_url && (
                  <button
                    onClick={() => setDraft({ ...current, logo_url: null })}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove logo
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Theme presets ─────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="h-[3px] bg-gradient-to-r from-primary to-accent" />
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Theme Presets</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    "relative text-left rounded-xl border p-3 transition-all hover:shadow-sm",
                    activePreset === preset.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  {/* Color swatches */}
                  <div className="flex gap-1 mb-2.5">
                    {[preset.settings.primary_color, preset.settings.secondary_color, preset.settings.accent_color].map((c, i) => (
                      <div
                        key={i}
                        className="w-5 h-5 rounded-full border border-white/20 shadow-sm"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <p className="text-xs font-semibold truncate">{preset.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{preset.description}</p>
                  {activePreset === preset.id && (
                    <div className="absolute top-2 right-2">
                      <Check className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Advanced: custom colors ───────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted-foreground" />
              <div className="text-left">
                <p className="text-sm font-semibold">Advanced: Custom Colors</p>
                <p className="text-xs text-muted-foreground">Fine-tune individual color values</p>
              </div>
            </div>
            {showAdvanced
              ? <ChevronUp   className="w-4 h-4 text-muted-foreground shrink-0" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            }
          </button>

          {showAdvanced && (
            <div className="px-5 pb-5 border-t border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-5">
                {(
                  [
                    { field: 'primary_color'   as const, label: 'Primary',   desc: 'Buttons, active states, badges'    },
                    { field: 'secondary_color' as const, label: 'Secondary', desc: 'Charts, supporting elements'        },
                    { field: 'accent_color'    as const, label: 'Accent',    desc: 'Highlights, gradient end color'     },
                  ] as const
                ).map(({ field, label, desc }) => {
                  const value = current[field] as string
                  return (
                    <div key={field} className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {label}
                      </label>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <input
                            type="color"
                            value={value}
                            onChange={e => updateColor(field, e.target.value)}
                            className="w-10 h-10 rounded-lg cursor-pointer border border-border appearance-none bg-transparent p-0.5"
                          />
                        </div>
                        <input
                          type="text"
                          value={value}
                          onChange={e => {
                            const v = e.target.value
                            if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                              updateColor(field, v)
                            }
                          }}
                          onBlur={e => {
                            if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                              updateColor(field, value) // revert invalid
                            }
                          }}
                          placeholder="#000000"
                          maxLength={7}
                          className="flex-1 px-3 py-2 text-xs rounded-lg border border-border bg-muted font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          onClick={() => copyToClipboard(value, field)}
                          className={cn(
                            'px-2 py-1.5 text-xs rounded-lg border transition-colors',
                            copied === field
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border bg-muted hover:bg-muted/70 text-muted-foreground'
                          )}
                        >
                          {copied === field ? <Check className="w-3 h-3" /> : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── Live preview ──────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${current.primary_color}, ${current.accent_color})` }} />
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-4">Live Preview</h2>
            <div className="space-y-3">
              <button
                style={{ background: current.primary_color }}
                className="w-full py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Primary Button
              </button>
              <div className="grid grid-cols-2 gap-3">
                <div
                  className="rounded-xl border p-4"
                  style={{ borderTopColor: current.primary_color, borderTopWidth: 3, borderTopStyle: 'solid' }}
                >
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">KPI Metric</p>
                  <p className="text-2xl font-extrabold" style={{ color: current.primary_color }}>1,234</p>
                  <p className="text-xs text-muted-foreground mt-1">↑ 12% vs last period</p>
                </div>
                <div className="rounded-xl overflow-hidden flex gap-2 p-2 bg-muted/30 border border-border">
                  <div className="flex-1 rounded-lg" style={{ background: current.primary_color, opacity: 0.85 }} />
                  <div className="flex-1 rounded-lg" style={{ background: current.secondary_color, opacity: 0.85 }} />
                  <div className="flex-1 rounded-lg" style={{ background: current.accent_color, opacity: 0.85 }} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Footer actions ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={handleReset}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-muted hover:bg-muted/70 text-sm font-semibold disabled:opacity-60 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Default
          </button>

          <div className="flex items-center gap-3">
            {hasUnsaved && !saving && !saved && (
              <p className="text-xs text-amber-500 font-medium animate-pulse">
                Unsaved changes
              </p>
            )}
            {saved && (
              <p className="text-xs text-emerald-500 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" /> Saved!
              </p>
            )}
            <button
              onClick={handleSave}
              disabled={saving || (!hasUnsaved && !saved)}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all",
                hasUnsaved
                  ? "bg-primary text-primary-foreground hover:opacity-90 shadow-sm"
                  : "bg-muted text-muted-foreground border border-border",
                "disabled:opacity-60"
              )}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
