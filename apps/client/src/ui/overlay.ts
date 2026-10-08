/**
 * World markers and the compass strip (§4.14, §4.15). Updated every frame, so they
 * write to the DOM directly instead of re-rendering through Preact.
 */

export interface Mark {
  x: number;
  y: number;
  /** Icon character and label. */
  icon: string;
  label: string;
  /** CSS class: ping-0..6, valuable, teammate… */
  cls: string;
  dist: number;
}

export class MarkerLayer {
  private readonly root: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private used = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'markers';
    parent.appendChild(this.root);
  }

  begin(): void {
    this.used = 0;
  }

  add(m: Mark): void {
    let el = this.pool[this.used];
    if (!el) {
      el = document.createElement('div');
      el.innerHTML = '<i></i><b></b><span></span>';
      this.root.appendChild(el);
      this.pool.push(el);
    }
    this.used++;
    el.className = `marker ${m.cls}`;
    el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
    const [i, b, span] = el.children as unknown as [HTMLElement, HTMLElement, HTMLElement];
    if (i.textContent !== m.icon) i.textContent = m.icon;
    if (b.textContent !== m.label) b.textContent = m.label;
    const d = m.dist >= 0 ? `${Math.round(m.dist)} m` : '';
    if (span.textContent !== d) span.textContent = d;
    el.style.display = '';
  }

  end(): void {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.style.display = 'none';
  }

  set colorblind(on: boolean) {
    this.root.classList.toggle('cb', on);
  }

  dispose(): void {
    this.root.remove();
  }
}

export interface CompassMark {
  /** World bearing (radians, same convention as yaw: 0 = -Z, positive turns left). */
  bearing: number;
  icon: string;
  cls: string;
  title: string;
}

const LETTERS: Array<[number, string]> = [
  [0, 'N'],
  [Math.PI / 4, 'NW'],
  [Math.PI / 2, 'W'],
  [(3 * Math.PI) / 4, 'SW'],
  [Math.PI, 'S'],
  [(-3 * Math.PI) / 4, 'SE'],
  [-Math.PI / 2, 'E'],
  [-Math.PI / 4, 'NE'],
];

/** A heading strip showing ±90° around where you look. */
export class CompassStrip {
  private readonly root: HTMLDivElement;
  private readonly letters: HTMLSpanElement[] = [];
  private readonly pool: HTMLSpanElement[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'compass';
    this.root.dataset.testid = 'compass';
    for (const [, l] of LETTERS) {
      const s = document.createElement('span');
      s.className = l.length === 1 ? 'cdir major' : 'cdir';
      s.textContent = l;
      this.root.appendChild(s);
      this.letters.push(s);
    }
    parent.appendChild(this.root);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  update(heading: number, marks: CompassMark[]): void {
    const place = (el: HTMLElement, bearing: number) => {
      // Positive yaw turns left, so things to the left have larger bearings.
      let d = bearing - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const visible = Math.abs(d) < Math.PI / 2;
      el.style.display = visible ? '' : 'none';
      if (visible) el.style.left = `${(50 - (d / (Math.PI / 2)) * 50).toFixed(2)}%`;
    };
    LETTERS.forEach(([b], i) => place(this.letters[i]!, b));
    marks.forEach((m, i) => {
      let el = this.pool[i];
      if (!el) {
        el = document.createElement('span');
        this.root.appendChild(el);
        this.pool.push(el);
      }
      el.className = `cmark ${m.cls}`;
      el.textContent = m.icon;
      el.title = m.title;
      place(el, m.bearing);
    });
    for (let i = marks.length; i < this.pool.length; i++) this.pool[i]!.style.display = 'none';
  }

  set colorblind(on: boolean) {
    this.root.classList.toggle('cb', on);
  }

  dispose(): void {
    this.root.remove();
  }
}
