export default function ResultsScreen({ matches, onRestart }) {
  return (
    <section className="screen active">
      <h2>Here's what you both liked 🎉</h2>

      <div className="results-list">
        {matches.map((item) => (
          <div className="result-item" key={item.id}>
            {item.poster ? (
              <img className="r-poster" src={item.poster} alt={item.title} />
            ) : (
              <div className="r-emoji">{item.emoji}</div>
            )}
            <div>
              <div className="r-title">{item.title}</div>
              <div className="r-subtitle">{item.subtitle}</div>
            </div>
          </div>
        ))}
      </div>

      {matches.length === 0 && (
        <p className="no-matches-text">
          No overlap this time — happens to the best of us. Try another category!
        </p>
      )}

      <button className="btn btn-primary" onClick={onRestart}>Start a New Round</button>
    </section>
  );
}
