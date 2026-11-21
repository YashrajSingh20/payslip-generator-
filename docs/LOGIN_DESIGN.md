# Login page design: "Smoke"

A sign-in screen with live orange smoke over the whole page and a single frosted
card in the centre. Designed during Keystone Payroll work (Payroll itself uses the
Team Portal style login); this file holds everything needed to build it in another
project, including the full smoke component in section 9.

Smoke shader adapted from "Smoke Login" by Aakash Mehra.

---

## 1. Layout

```
┌───────────────────────────────────────────────────────────┐
│ [logo | logo]                                    ( ☾ )    │  header, 20px / 28px from the edges
│                                                           │
│                ┌───────────────────────────┐              │
│                │ Keystone Payroll          │              │  card, max 420px wide,
│                │                           │              │  centred both ways
│                │ Work email                │              │
│                │ [ you@company.com       ] │              │
│                │ [       Continue  →     ] │              │
│                └───────────────────────────┘              │
│                                                           │
│           © 2026 Keystone Commerce Private Limited        │  footer, centred
└───────────────────────────────────────────────────────────┘
        full-screen WebGL smoke + paper grain behind everything
```

- Page: `min-h-dvh`, flex column (header / main / footer). `overflow: hidden`.
- Smoke layer: `position: fixed; inset: 0; z-index: -1` (root has `isolation: isolate`).
- Edge fade over the smoke so the logos and footer stay readable:
  `linear-gradient(to bottom, var(--paper) 0%, transparent 16%, transparent 84%, var(--paper) 100%)` at 80% opacity.
- Same layout on phones: the card fills the width with 16px side padding. Respect
  `env(safe-area-inset-top/bottom)` for the header and footer.

## 2. Colour tokens

Set on the root element as CSS variables; switching theme swaps the whole set.
Everything animates with `transition-colors 700ms`.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--paper` | `#faf7f3` | `#14100d` | Page background, card fill, edge fade |
| `--ink` | `#1d1511` | `#f3ede7` | Text |
| `--muted` | `#8b7f77` | `#9b9088` | Labels, footer, secondary text |
| `--line` | `#e2d8ce` | `#2b231e` | Borders |
| `--field` | `#fdfbf8` | `#17120f` | Inputs, round buttons |
| `--accent` | `#fa4b12` | `#fa4b12` | Brand orange: focus rings, links, title highlight |
| `--btn` | `#1d1511` | `#fa4b12` | Primary button fill |
| `--btn-ink` | `#faf7f3` | `#fff8f3` | Primary button text |
| `--danger` | `#c2410c` | `#ff8a5c` | Error text |
| `--grain-blend` | `multiply` | `soft-light` | Blend mode of the grain overlay |

To use a different brand colour, change `--accent` (and `--btn` in dark) **and** the
`ember` / vein colours in the shader (section 6).

## 3. Typography

| Role | Font | Size | Notes |
|---|---|---|---|
| Card title | Instrument Serif 400 | 44px phone / 50px ≥640px | `line-height: 1`, `letter-spacing: -0.01em`; second word italic in `--accent` |
| Body, labels, buttons | Plus Jakarta Sans | label 13px/500, button 15px/500, input 16px phone / 15px desktop | 16px on phones stops iOS zooming into the field |
| Code digits | Geist Mono | 22px/500 | One-time-code boxes |
| Footer | Plus Jakarta Sans | 12px | `--muted` |

## 4. Components

**Card**
- `max-width: 420px`, radius `28px`, padding `28px` (phone) / `40px` (≥640px)
- Border `1px var(--line)`
- Fill `color-mix(in oklab, var(--paper) 80%, transparent)` + `backdrop-filter: blur(40px)`
- Shadow `inset 0 1px 0 rgb(255 255 255 / .08), 0 30px 80px -30px rgb(0 0 0 / .55)`

**Text input**
- Height 48px, radius 14px, padding 0 16px, `--field` fill, `--line` border, inset shadow `0 1px 2px rgb(0 0 0 / .04)`
- Focus: border `--accent` + ring `0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent)`
- Label above it, 8px gap

**Primary button**
- Full width, height 48px, radius 14px, `--btn` fill, `--btn-ink` text, label + arrow icon
- Shadow `inset 0 1px 0 rgb(255 255 255/.18), 0 1px 2px rgb(0 0 0/.2), 0 10px 24px -12px rgb(0 0 0/.5)`
- Hover: last shadow becomes `0 14px 30px -12px var(--accent)` (orange glow) and the arrow nudges 2px right
- Press: `scale(.985)`. Loading: spinner replaces the label.
- Easing `cubic-bezier(.22, 1, .36, 1)`, 300ms

**One-time-code boxes** (6 across, 8px gap): height 56px, radius 14px, same field style; the
active box gets the accent border and ring.

**Theme switch**: 40px round button, `--field` fill, `--line` border, sun/moon icon in
`--muted`. The icon swaps with a spring rotate + blur (stiffness 380, damping 26).
The choice is saved in `localStorage` (wrapped in try/catch). Default: dark.

**Logos**: two wordmarks with a 1px divider (`--ink` at 20% opacity), heights 28px / 32px.
In dark mode they turn white with `filter: brightness(0) invert(1)`.

**Error**: one line under the field, 13px, `--danger`, with an alert icon. No box.

## 5. Motion

- **Entrance:** each block rises out of a blur, staggered.
  - From `opacity 0, y 10px, blur(10px)` to `opacity 1, y 0, blur(0)`.
  - Duration 0.9s, delay `0.15s + i × 0.07s`, ease `[0.22, 1, 0.36, 1]`.
  - Order: logos, card, title, field, button.
- **Step change** (email to code): the old step exits `y -6px, blur(6px)` in 0.25s; the new one enters the same way as the entrance, in 0.6s.
- **Theme change:** colours transition over 700ms; the smoke eases between themes inside the shader.
- **Reduced motion:** entrance becomes a plain fade and the smoke draws one still frame.

## 6. The smoke

- **Rendering:** one full-screen WebGL fragment shader.
  - Domain-warped fractal noise, warped twice, gives the curling plumes.
  - A thin orange "vein" runs along one plume edge, with a softer glow around it.
- **Pointer:** moving the mouse stirs a slow eddy where it is.
- **Cost:** renders at 40% resolution (the browser upscales it) and is capped at 30fps.
- **Fallback:** if WebGL is unavailable, the `--paper` colour shows instead.
- **Grain:** an SVG `feTurbulence` grain sits on top at 60% opacity, blended with `--grain-blend`:

```js
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
```

Shader colours (RGB 0–1). Change these for another brand:

| Name | Value | Meaning |
|---|---|---|
| `ember` | `.98, .294, .071` | Brand orange `#fa4b12`, used for the glow |
| light vein | `.886, .243, .031` | Darker orange line on paper |
| light paper | `.98, .969, .953` | Matches `--paper` light |
| light smoke | `.165, .086, .047` | Cocoa ink |
| dark background | `.055, .04, .035` → `.035, .027, .024` | Warm near-black, top to bottom |
| dark smoke | `.82, .78, .74` | Pale warm smoke |
| dark vein | `1., .5, .2` | Bright orange line |

## 7. Dependencies

- React 18+
- Tailwind CSS 3 (the reference uses arbitrary values such as `bg-[var(--paper)]`)
- `framer-motion` (or `motion`)
- `lucide-react` icons: `ArrowRight`, `ArrowLeft`, `LoaderCircle`, `Moon`, `Sun`, `OctagonAlert`
- `input-otp`, only for the code step
- Fonts from `next/font/google`: Instrument Serif, Plus Jakarta Sans, Geist Mono

## 8. Page skeleton

```jsx
<div style={THEMES[theme]} className="relative isolate flex min-h-dvh w-full flex-col overflow-hidden bg-[var(--paper)] text-[var(--ink)] transition-colors duration-700">
  <div className="fixed inset-0 -z-10">
    <SmokeCanvas dark={dark} />
    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60"
         style={{ backgroundImage: GRAIN, mixBlendMode: 'var(--grain-blend)' }} />
    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-80"
         style={{ background: 'linear-gradient(to bottom, var(--paper) 0%, transparent 16%, transparent 84%, var(--paper) 100%)' }} />
  </div>

  <header className="flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 sm:pt-7">
    <LogoPair dark={dark} />
    <ThemeSwitch dark={dark} onToggle={toggleTheme} />
  </header>

  <main className="flex flex-1 items-center justify-center px-4 py-10">
    <div className="w-full max-w-[420px] rounded-[28px] border border-[var(--line)] bg-[color-mix(in_oklab,var(--paper)_80%,transparent)] p-7 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset,0_30px_80px_-30px_rgb(0_0_0/0.55)] backdrop-blur-2xl sm:p-10">
      <h1 className="font-display text-[44px] leading-none tracking-[-0.01em] sm:text-[50px]">
        Keystone <em className="text-[var(--accent)]">Payroll</em>
      </h1>
      {/* label + input + button, see section 4 */}
    </div>
  </main>

  <footer className="pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-[12px] text-[var(--muted)]">
    © {new Date().getFullYear()} Company name
  </footer>
</div>
```

## 9. Smoke component (copy as is)

`SmokeCanvas.jsx`: no dependencies beyond React.

```jsx
'use client';

/**
 * Live smoke on paper: one WebGL fragment shader (domain-warped noise) with an
 * ember vein running through the plumes. The pointer stirs it. `dark` eases the
 * smoke between pale-smoke-in-the-dark and ink-on-paper. Holds still under
 * prefers-reduced-motion. Adapted from "Smoke Login" by Aakash Mehra.
 */
import { useEffect, useRef } from 'react';

// Smoke is all soft gradients, so render small and let the browser upscale it.
const RENDER_SCALE = 0.4;

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uDark;

float hash(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  mat2 r = mat2(.8, .6, -.6, .8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.02 + vec2(1.7, 9.2); a *= .5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float ar = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * ar, uv.y) * 1.25;
  float t = uTime * .07;

  vec2 d = p - vec2(uMouse.x * ar, uMouse.y) * 1.25;
  float k = exp(-dot(d, d) * 1.6);
  p += vec2(-d.y, d.x) * k * .55;

  vec2 q = vec2(fbm(p + vec2(0., t)), fbm(p + vec2(5.2, 1.3) - t * .8));
  vec2 r = vec2(fbm(p + 3. * q + vec2(1.7, 9.2) + t * 1.2), fbm(p + 3. * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 2.6 * r + vec2(t * .4, -t * .3));

  float smoke = smoothstep(.3, .85, f);
  smoke *= smoke;
  float wisp = smoothstep(.55, .75, f) * (1. - smoothstep(.75, .95, f));
  float vein = (1. - smoothstep(.0, .04, abs(f - .58))) * smoothstep(.42, .62, r.y);
  float glow = (1. - smoothstep(.0, .14, abs(f - .58))) * smoothstep(.42, .62, r.y);

  // Keystone ember #fa4b12
  vec3 ember = vec3(.98, .294, .071);

  // light: cocoa ink on warm paper
  vec3 paper = vec3(.98, .969, .953);
  vec3 lit = mix(paper, vec3(.165, .086, .047), smoke * .9);
  lit = mix(lit, vec3(.886, .243, .031), vein * .8);
  lit = mix(lit, ember, glow * .12);
  lit += (1. - smoke) * wisp * .03;

  // dark: pale warm smoke, ember glowing through it
  vec3 night = mix(vec3(.055, .04, .035), vec3(.035, .027, .024), uv.y);
  vec3 drk = night + vec3(.82, .78, .74) * smoke * .6 + vec3(.9) * wisp * .08;
  drk += ember * glow * .22 + vec3(1., .5, .2) * vein * .85;

  vec3 col = mix(lit, drk, uDark);
  col += (hash(gl_FragCoord.xy + fract(t)) - .5) / 255.;
  gl_FragColor = vec4(col, 1.);
}`;

export function SmokeCanvas({ dark }) {
  const ref = useRef(null);
  const darkRef = useRef(dark ? 1 : 0);
  const redraw = useRef(() => {});

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!canvas || !gl) return undefined; // The paper colour behind stands in.

    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uMouse = gl.getUniformLocation(program, 'uMouse');
    const uDark = gl.getUniformLocation(program, 'uDark');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = performance.now();
    const mouse = { x: 0.7, y: 0.4, tx: 0.7, ty: 0.4 };
    let shade = darkRef.current;
    let time = 40; // start mid-drift so the first frame is already full of smoke
    let raf = 0;
    let last = 0;

    const draw = () => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uDark, shade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / 30 - 2) return; // slow smoke doesn't need more than 30fps
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      time = 40 + (now - start) / 1000;
      mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 2.2);
      mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 2.2);
      shade += (darkRef.current - shade) * Math.min(1, dt * 3.5);
      draw();
    };
    const play = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches) draw();
      else raf = requestAnimationFrame(loop);
    };
    redraw.current = () => {
      if (!reduce.matches) return;
      shade = darkRef.current;
      draw();
    };

    const onMove = (e) => {
      const b = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - b.left) / b.width;
      mouse.ty = 1 - (e.clientY - b.top) / b.height;
    };

    const ro = new ResizeObserver(() => {
      const s = Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALE;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * s));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * s));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    });
    ro.observe(canvas);
    canvas.addEventListener('pointermove', onMove);
    reduce.addEventListener('change', play);
    play();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      reduce.removeEventListener('change', play);
    };
  }, []);

  useEffect(() => {
    darkRef.current = dark ? 1 : 0;
    redraw.current();
  }, [dark]);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />;
}
```
