/** Credits (§13) and the privacy notice (§10). */
export function Credits() {
  return (
    <div class="info" data-testid="credits">
      <p>
        <b>Dead Tracks</b> is free and open source under the AGPL-3.0. Every model, texture, sky and
        sound in this version is generated in code, so there are no third-party art assets yet;
        any added later are listed with their licenses in <code>assets/LICENSES.md</code>.
      </p>
      <p>Built with:</p>
      <ul>
        <li>three.js (MIT): rendering, WebGPU and WebGL 2</li>
        <li>Rapier (Apache-2.0): physics, compiled to WebAssembly</li>
        <li>Colyseus (MIT): multiplayer rooms and state sync</li>
        <li>Preact (MIT): menus and HUD</li>
        <li>Drizzle ORM (Apache-2.0) and SQLite: accounts</li>
        <li>Vite (MIT), TypeScript (Apache-2.0), Vitest and Playwright (MIT/Apache-2.0)</li>
      </ul>
      <p>The "Dead Tracks" name and logo are not open-licensed.</p>
    </div>
  );
}

export function PrivacyNotice() {
  return (
    <div class="info" data-testid="privacy">
      <p>
        <b>What we keep.</b> Playing as a guest stores a random id and a generated name on our
        server, with your bonds, unlocked classes and lifetime stats. If you sign in with Discord,
        Google or GitHub we also store that provider's user id and display name, and nothing else
        from your account.
      </p>
      <p>
        <b>Anonymous game stats.</b> To balance the game we record runs started and finished,
        where they end, where players die and what killed them, towns visited, fuel and cash
        curves, and the frame rate and quality tier per kind of device. These are not linked to
        your name.
      </p>
      <p>
        <b>Crash reports.</b> If the game crashes, an error report (the error, browser and device
        type) may be sent to Sentry so we can fix it.
      </p>
      <p>
        <b>Never.</b> No ads, no ad trackers, no third-party analytics, no selling data. There is no
        text or voice chat. Your settings stay in your browser.
      </p>
      <p>
        Want your account deleted? Open an issue on the project's GitHub page or contact the
        maintainers there, with your username.
      </p>
    </div>
  );
}
