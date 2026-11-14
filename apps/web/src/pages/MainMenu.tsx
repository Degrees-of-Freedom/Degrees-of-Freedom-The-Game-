import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameStore } from '../game/store';
import type { PresentationStyle } from '../game/modes';
import { MODE_CATALOG, STYLE_CATALOG } from '../components/runtimeCatalog';

/** Modes configure rules; styles configure the single shared scene. */
export function MainMenu() {
  const navigate = useNavigate();
  const [style, setStyle] = useState<PresentationStyle | null>(null);
  return <main className="main-menu">
    <section className="menu-intro">
      <div><p className="eyebrow">THE STRUCTURAL PLAYGROUND</p>
        <h1>A little structure.<br /><em>A world of possibilities.</em></h1>
        <p>Grow a frame. Follow a force. Find the connection that changes everything.</p>
        <Link className="resume-link" to="/play">Continue in the workspace →</Link>
      </div>
      <div className="menu-sculpture" aria-hidden="true"><span /><span /><span /><span /><span /><i>✳</i></div>
    </section>
    <section aria-labelledby="mode-heading">
      <div className="section-heading"><div><p className="eyebrow">01 / CHOOSE YOUR CHALLENGE</p><h2 id="mode-heading">How will you play?</h2></div><p>One structure. Many ways to discover it.</p></div>
      <div className="mode-grid">{MODE_CATALOG.map((mode, index) => <button key={mode.id} className={`mode-card mode-${mode.id}`} onClick={() => {
        const game = useGameStore.getState();
        game.setMode(mode.id);
        game.setStyle(style ?? mode.style);
        navigate('/play');
      }}><span className="mode-number">0{index + 1} ↗</span><small>{mode.subtitle}</small><h3>{mode.title}</h3><p>{mode.description}</p><span className="mode-start">Enter workspace →</span></button>)}</div>
    </section>
    <section className="style-section" aria-labelledby="style-heading"><p className="eyebrow">02 / MAKE IT YOUR OWN</p><h2 id="style-heading">Choose a building style</h2><p>Switch styles any time without losing your structure.</p><div className="style-grid">{STYLE_CATALOG.map((item) => <button key={item.id} className={`style-card style-${item.id}`} aria-pressed={style === item.id} onClick={() => setStyle(style === item.id ? null : item.id)}><span className="style-swatch" /><strong>{item.title}</strong><small>{item.description}</small></button>)}</div></section>
    <footer>DEGREES OF FREEDOM <span>BUILD · CONNECT · DISCOVER</span></footer>
  </main>;
}
