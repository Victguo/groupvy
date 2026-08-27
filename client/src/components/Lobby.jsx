export default function Lobby({ roomCode, deckLabel, participants, onStart }) {
  return (
    <section className="screen active">
      <div className="lobby-box">
        <p className="lobby-label">Room code</p>
        <div className="lobby-code">{roomCode}</div>
        <p className="lobby-hint">Share this code with your partner or group so they can join.</p>
        <p className="lobby-deck">Category: {deckLabel}</p>
        <div className="participants-list">
          {participants.map((name, i) => (
            <div className="participant-chip" key={i}>{name}</div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={onStart}>Start Swiping</button>
      </div>
    </section>
  );
}
