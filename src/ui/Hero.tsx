import { useEffect, useMemo, useRef } from 'react';
import { TEAMS, OWNERS, COST_CENTERS } from '../data/demo.ts';

/**
 * Animated hero background: a 3D-tilted plane of scrolling tag chips built
 * from the real demo dataset. Per-column scanlines sweep top->bottom; when a
 * scanline crosses an "untagged" chip (one with a null-token/missing value or
 * a bare resource id), it flashes red, briefly reads "untagged", and shows an
 * unallocated-cost badge — the product performing itself.
 *
 * Performance rules: animations are transform-only (compositor path); the
 * per-depth blur is static; hit detection polls bounding rects at 8Hz but is
 * gated by an IntersectionObserver and tab visibility, and rect reads are
 * cheap here because nothing dirties layout between frames.
 * prefers-reduced-motion gets a frozen frame with a single highlighted chip.
 */

interface ChipSpec {
  html: string;
  untagged: boolean;
  cost?: string;
}

const COLUMNS = 7;
const CHIPS_PER_CHUNK = 24;
const SCROLL_DURATIONS = [46, 38, 30, 34, 42, 50, 36];
const SCAN_DURATIONS = [6.5, 5.2, 7.8, 5.8, 7.1, 6.1, 8.4];
const SCAN_DELAYS = [0, 1.7, 3.1, 0.9, 2.4, 4.2, 1.2];
const DEPTHS = ['d3', 'd2', 'd1', 'd1', 'd1', 'd2', 'd3'];
const FLASH_MS = 1600;
const COOLDOWN_MS = 4000;
const TICK_MS = 120;

const RESOURCE_IDS: Array<[string, string]> = [
  ['i-0deadbeef', '$2,450'],
  ['db-shared-01', '$805'],
  ['bucket-logs', '$67'],
  ['fn-a41f2', '$12'],
  ['vm-d454b', '$540'],
  ['sqldb-75e6d', '$773'],
  ['gce-batch-7', '$318'],
  ['bq-events', '$1,604'],
  ['i-05f2e2', '$81'],
  ['snap-0f3l6', '$55'],
];

const NULL_VALUES: Array<[string, string]> = [
  ['owner', 'n/a'],
  ['team', '—'],
  ['env', ''],
  ['cost_center', 'none'],
  ['owner', ''],
];

function buildChips(seed: number): ChipSpec[] {
  // deterministic PRNG so SSR/hydration or re-renders don't reshuffle
  let a = seed;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const tagged: Array<[string, string]> = [];
  for (const team of TEAMS) {
    tagged.push(['team', team], ['cost_center', COST_CENTERS[team]]);
    for (const o of OWNERS[team]) tagged.push(['owner', o]);
  }
  tagged.push(['env', 'prod'], ['env', 'staging'], ['env', 'dev'], ['env', 'production']);

  const chips: ChipSpec[] = [];
  for (let i = 0; i < CHIPS_PER_CHUNK; i++) {
    const r = rnd();
    if (r < 0.3) {
      const [id, cost] = pick(RESOURCE_IDS);
      chips.push({ html: id, untagged: true, cost });
    } else if (r < 0.46) {
      const [k, v] = pick(NULL_VALUES);
      chips.push({
        html: `<span class="hero-k">${k}:</span> ${v || '&nbsp;'}`,
        untagged: true,
        cost: '$' + (40 + Math.floor(rnd() * 900)),
      });
    } else {
      const [k, v] = pick(tagged);
      chips.push({ html: `<span class="hero-k">${k}:</span> ${v}`, untagged: false });
    }
  }
  return chips;
}

export default function Hero() {
  const rootRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => Array.from({ length: COLUMNS }, (_, c) => buildChips(20260708 + c * 977)), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // dynamic zoom: the plane's natural width is ~1400px (7 columns); scale it
    // to always overfill the viewport, capped so chips stay believable
    const applyScale = () => {
      const scale = Math.min(2.4, Math.max(1.2, root.clientWidth / 1200));
      root.style.setProperty('--hero-scale', String(scale));
    };
    applyScale();
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyScale);
    };
    window.addEventListener('resize', onResize);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      root.querySelectorAll<HTMLElement>('.hero-col, .hero-scan').forEach((el) => {
        el.style.animation = 'none';
      });
      const candidates = root.querySelectorAll<HTMLElement>('.hero-chip[data-un]');
      const chip = candidates[Math.min(5, candidates.length - 1)];
      if (chip) {
        chip.classList.add('hero-chip--hit');
        chip.innerHTML = 'untagged';
      }
      return () => window.removeEventListener('resize', onResize);
    }

    let visible = true;
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        root.querySelectorAll<HTMLElement>('.hero-col, .hero-scan').forEach((el) => {
          el.style.animationPlayState = visible ? 'running' : 'paused';
        });
      },
      { threshold: 0.05 },
    );
    observer.observe(root);

    const cooling = new WeakSet<Element>();
    const timers: number[] = [];
    const interval = window.setInterval(() => {
      if (!visible || document.visibilityState !== 'visible') return;
      root.querySelectorAll<HTMLElement>('.hero-colwrap').forEach((wrap) => {
        const scan = wrap.querySelector<HTMLElement>('.hero-scan');
        if (!scan) return;
        const line = scan.getBoundingClientRect();
        const lineY = line.top + line.height / 2;
        wrap.querySelectorAll<HTMLElement>('.hero-chip[data-un]').forEach((chip) => {
          if (cooling.has(chip)) return;
          const r = chip.getBoundingClientRect();
          if (r.height === 0) return;
          if (lineY >= r.top && lineY <= r.bottom) {
            cooling.add(chip);
            const orig = chip.dataset.orig ?? chip.innerHTML;
            chip.classList.add('hero-chip--hit');
            chip.innerHTML = 'untagged';
            timers.push(
              window.setTimeout(() => {
                chip.classList.remove('hero-chip--hit');
                chip.innerHTML = orig;
                timers.push(window.setTimeout(() => cooling.delete(chip), COOLDOWN_MS));
              }, FLASH_MS),
            );
          }
        });
      });
    }, TICK_MS);

    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      window.clearInterval(interval);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <div className="hero-bg" ref={rootRef} aria-hidden="true">
      <div className="hero-persp">
        <div className="hero-plane">
          {columns.map((chips, c) => (
            <div key={c} className={`hero-colwrap hero-${DEPTHS[c]}`}>
              <div className="hero-col" style={{ animationDuration: `${SCROLL_DURATIONS[c]}s` }}>
                {[0, 1].map((copy) => (
                  <div key={copy} className="hero-chunk">
                    {chips.map((chip, i) => (
                      <div
                        key={i}
                        className="hero-chip"
                        data-un={chip.untagged ? '1' : undefined}
                        data-cost={chip.cost}
                        data-orig={chip.html}
                        dangerouslySetInnerHTML={{ __html: chip.html }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div
                className="hero-scan"
                style={{
                  animationDuration: `${SCAN_DURATIONS[c]}s`,
                  animationDelay: `-${SCAN_DELAYS[c]}s`,
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="hero-vignette" />
    </div>
  );
}
