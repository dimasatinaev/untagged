import { useEffect, useState } from 'react';
import type { AnalysisResult, ColumnMapping, DetectionResult } from './engine/types.ts';
import { sampleCsv } from './engine/csv.ts';
import { detectColumns } from './engine/detect.ts';
import { analyzeCsvText } from './engine/analyze.ts';
import { DEFAULT_POLICY } from './engine/policy.ts';
import { generateDemoCsv, DEMO_COMPANY } from './data/demo.ts';
import UploadScreen from './ui/UploadScreen.tsx';
import MappingScreen from './ui/MappingScreen.tsx';
import Dashboard from './ui/Dashboard.tsx';
import ResourceExplorer from './ui/ResourceExplorer.tsx';
import MethodPage from './ui/MethodPage.tsx';

type Stage = 'upload' | 'mapping' | 'results' | 'explorer' | 'method';

export interface Session {
  fileName: string;
  /** full raw CSV text — analyzed in a streaming pass, never fully parsed */
  text: string;
  /** first N rows used for detection and the mapping preview */
  sample: { headers: string[]; rows: string[][]; delimiter: string };
  detection: DetectionResult;
  mapping: ColumnMapping;
  result?: AnalysisResult;
  skippedRows?: number;
  rowCount?: number;
  isDemo: boolean;
}

const SAMPLE_ROWS = 500;

/** PLACEHOLDER — replace with the real public repository URL before launch */
export const REPO_URL = 'https://github.com/PLACEHOLDER/untagged';

type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  const stored = localStorage.getItem('untagged-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function App() {
  const [stage, setStage] = useState<Stage>('upload');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('untagged-theme', theme);
  }, [theme]);

  // scroll-reveal: elements with .reveal get .in when they enter the viewport
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (els.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [stage]);

  function loadCsv(text: string, fileName: string, isDemo: boolean) {
    setError(null);
    try {
      const sample = sampleCsv(text, SAMPLE_ROWS);
      if (sample.headers.length === 0 || sample.rows.length === 0) {
        setError(
          sample.headers.length === 0
            ? "We couldn't find any data in that file. Is it a CSV export?"
            : 'The file has headers but no data rows.',
        );
        return;
      }
      const detection = detectColumns(sample.headers, DEFAULT_POLICY, sample.rows);
      setSession({
        fileName,
        text,
        sample,
        detection,
        mapping: structuredClone(detection.mapping),
        isDemo,
      });
      setStage('mapping');
    } catch (e) {
      setError('Something went wrong while parsing the file. ' + (e instanceof Error ? e.message : ''));
    }
  }

  function handleDemo() {
    loadCsv(generateDemoCsv(200), DEMO_COMPANY, true);
  }

  function handleAnalyze(mapping: ColumnMapping) {
    if (!session || analyzing) return;
    setAnalysisError(null);
    setAnalyzing(true);
    // yield to the browser so the "Analyzing…" state paints before the
    // synchronous streaming pass starts
    window.setTimeout(() => {
      try {
        const { result, skippedRows, rowCount } = analyzeCsvText(session.text, mapping, DEFAULT_POLICY);
        if (result.currencies.length > 1) {
          setAnalysisError(
            `This file mixes ${result.currencies.length} currencies (${result.currencies.join(
              ', ',
            )}). Amounts in different currencies cannot be summed, so no score was calculated. Export a single-currency file (billing consoles can filter by billing currency) and try again.`,
          );
          return;
        }
        setSession({ ...session, mapping, result, skippedRows, rowCount });
        setStage('results');
      } catch (e) {
        setAnalysisError(
          'Analysis failed: ' +
            (e instanceof Error ? e.message : 'unexpected error') +
            '. The file may be malformed — check the mapping or try re-exporting it.',
        );
      } finally {
        setAnalyzing(false);
      }
    }, 50);
  }

  function handleReset() {
    setSession(null);
    setError(null);
    setStage('upload');
  }

  return (
    <div className="app">
      <header className="app-header">
        <button className="brand" onClick={handleReset} aria-label="Untagged — back to start">
          <span className="brand-mark">un</span>tagged
        </button>
        <span className="brand-tagline">cloud cost allocation readiness auditor — nothing leaves your browser</span>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? 'light' : 'dark'}
        </button>
      </header>

      <main>
        <div className="stage" key={stage}>
        {stage === 'upload' && (
          <UploadScreen
            onCsv={loadCsv}
            onDemo={handleDemo}
            onMethod={() => setStage('method')}
            onError={(msg) => setError(msg)}
            error={error}
          />
        )}
        {stage === 'method' && (
          <MethodPage onBack={() => setStage(session?.result ? 'results' : 'upload')} />
        )}
        {stage === 'mapping' && session && (
          <MappingScreen
            session={session}
            onBack={handleReset}
            onAnalyze={handleAnalyze}
            analyzing={analyzing}
            error={analysisError}
          />
        )}
        {stage === 'results' && session?.result && (
          <Dashboard
            session={session}
            result={session.result}
            onBack={() => setStage('mapping')}
            onReset={handleReset}
            onExplore={() => setStage('explorer')}
          />
        )}
        {stage === 'explorer' && session?.result && (
          <ResourceExplorer
            result={session.result}
            fileName={session.fileName}
            onBack={() => setStage('results')}
          />
        )}
        </div>
      </main>

      <footer className="app-footer">
        <span>
          100% client-side ·{' '}
          <button className="linklike" onClick={() => setStage('method')}>
            open methodology
          </button>{' '}
          informed by the FinOps Foundation untagged-cost KPI playbook ·{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="placeholder-link">
            view source (PLACEHOLDER)
          </a>{' '}
          · free to use
        </span>
        <span className="app-footer__legal">
          © 2026 Dima Satinaev · code{' '}
          <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noreferrer">
            MIT
          </a>{' '}
          · content{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC BY 4.0
          </a>{' '}
          · provided "as is", no warranty — results are estimates, not financial advice
        </span>
      </footer>
    </div>
  );
}
