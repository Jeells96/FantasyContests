/**
 * A player's name wherever it is listed, tappable to open their scoring
 * breakdown. Falls back to plain text when nothing is listening, so the same
 * markup works on screens that have no sheet to open.
 */
export function PlayerName({
  name,
  playerId,
  onOpenPlayer,
  className,
}: {
  name: string;
  playerId: string;
  onOpenPlayer?: (playerId: string) => void;
  className?: string;
}) {
  if (!onOpenPlayer) return <>{name}</>;
  return (
    <button
      type="button"
      className={`namebtn${className ? ` ${className}` : ''}`}
      onClick={(event) => {
        // Rows are often clickable themselves; opening a player is not the same
        // as expanding the row it sits in.
        event.stopPropagation();
        onOpenPlayer(playerId);
      }}
    >
      {name}
    </button>
  );
}
