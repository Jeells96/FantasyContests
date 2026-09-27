import { useState } from 'react';
import { Sheet } from './ui';

/**
 * First-visit name prompt. The name is kept on the device and reused on later
 * visits; there is no password or account to manage.
 */
export function NameGate({ onSave }: { onSave: (firstName: string, lastName: string) => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const ready = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <Sheet title="Welcome" onClose={() => undefined}>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        Enter your name to play. It is saved on this device and used automatically next time — no account
        needed.
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onSave(firstName, lastName);
        }}
      >
        <div className="field">
          <label htmlFor="firstName">First name</label>
          <input
            id="firstName"
            className="input"
            value={firstName}
            autoComplete="given-name"
            autoFocus
            maxLength={30}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name</label>
          <input
            id="lastName"
            className="input"
            value={lastName}
            autoComplete="family-name"
            maxLength={30}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn--primary btn--block" disabled={!ready}>
          Start playing
        </button>
      </form>
    </Sheet>
  );
}
