import { useCallback, useRef, useState } from 'react';
import Hero from './Hero.tsx';

interface Props {
  onCsv: (text: string, fileName: string, isDemo: boolean) => void;
  onDemo: () => void;
  onMethod: () => void;
  onError: (message: string) => void;
  error: string | null;
}

export default function UploadScreen({ onCsv, onDemo, onMethod, onError, error }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [readPct, setReadPct] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reading = readPct !== null;

  const readFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      setReadPct(0);
      reader.onprogress = (e) => {
        if (e.lengthComputable) setReadPct(Math.round((e.loaded / e.total) * 100));
      };
      reader.onerror = () => {
        setReadPct(null);
        onError(`Couldn't read "${file.name}". The file may be locked, moved, or unreadable — try again.`);
      };
      reader.onabort = () => {
        setReadPct(null);
        onError('File reading was interrupted. Try again.');
      };
      reader.onload = () => {
        setReadPct(null);
        onCsv(String(reader.result ?? ''), file.name, false);
      };
      try {
        reader.readAsText(file);
      } catch (e) {
        setReadPct(null);
        onError('Could not open the file: ' + (e instanceof Error ? e.message : 'unknown error'));
      }
    },
    [onCsv, onError],
  );

  return (
    <>
    <section className="upload-screen">
      <Hero />
      <div className="upload-content">
      <h1 className="hero-enter hero-enter--1">
        How much of your cloud bill
        <br />
        can nobody explain?
      </h1>
      <p className="lede hero-enter hero-enter--2">
        Find the cloud spend missing required allocation tags. Drop in a cost export — get your allocation
        readiness score, unallocated spend, and a prioritized fix-list in about 30 seconds.
      </p>

      <div
        className={'dropzone hero-enter hero-enter--3' + (dragOver ? ' dropzone--active' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (reading) return;
          const file = e.dataTransfer.files?.[0];
          if (file) readFile(file);
        }}
        onClick={() => {
          if (!reading) inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        aria-disabled={reading}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !reading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Upload a CSV file"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
          }}
        />
        {reading ? (
          <>
            <strong role="status">Reading file… {readPct}%</strong>
            <span>Large exports can take a moment</span>
          </>
        ) : (
          <>
            <strong>Drop your CSV here</strong>
            <span>
              or click to browse — AWS CUR and Cost Explorer, Azure Cost Management (EA), FOCUS 1.0, or any
              CSV via manual mapping
            </span>
          </>
        )}
        <div className="dropzone-privacy">
          <strong>Your data never leaves this page.</strong> The file is parsed in your browser. File
          analysis makes no outbound network requests — the application cannot transmit your CSV because its
          Content-Security-Policy enforces <code>connect-src 'none'</code> (verify in DevTools → Network).
          No signup, no upload, no tracking of your data.
        </div>
      </div>

      {error && <p className="error-note" role="alert">{error}</p>}

      <button className="btn btn--ghost hero-enter hero-enter--4" onClick={onDemo}>
        No file handy? Try demo data →
      </button>
      </div>
    </section>

    <section className="below-hero">
      <span className="kicker">01 — How it works</span>
      <div className="how-it-works">
        <div className="how-step reveal">
          <span className="how-step__num">1</span>
          <h3>Drop a cost export</h3>
          <p>
            Tested against AWS CUR and Cost Explorer exports, Azure Cost Management (EA), and FOCUS 1.0 —
            any other CSV works through manual column mapping. You confirm the detected mapping in one
            click.
          </p>
        </div>
        <div className="how-step how-step--privacy reveal">
          <span className="how-step__num">2</span>
          <h3>Analyzed in your browser</h3>
          <p>
            The file is never uploaded. File analysis makes no outbound network requests — the application
            cannot transmit your CSV because its Content-Security-Policy enforces connect-src 'none'.
            Verifiable in DevTools → Network, auditable in the open source.
          </p>
        </div>
        <div className="how-step reveal">
          <span className="how-step__num">3</span>
          <h3>Get the argument, not just a number</h3>
          <p>
            Allocation readiness score and grade — checked against your complete selected tag policy, not
            just fully-untagged resources — plus unallocated spend, tag drift, and a prioritized fix-list.
          </p>
        </div>
      </div>

      <p className="how-method-link">
        Every scoring decision is documented — cost-weighting, null tokens, untaggable charges, credit
        netting.{' '}
        <button className="linklike" onClick={onMethod}>
          Read how the scoring works →
        </button>{' '}
        ·{' '}
        <a href="https://github.com/dimasatinaev/untagged" target="_blank" rel="noreferrer" className="linklike">
          View source
        </a>
      </p>
    </section>
    </>
  );
}
