export default function MatchToast({ item }) {
  return (
    <div className={'match-toast' + (item ? ' show' : '')}>
      <div className="match-toast-emoji">{item?.emoji ?? '🎉'}</div>
      <div className="match-toast-text">
        <div className="match-toast-title">It's a match!</div>
        <div className="match-toast-item">{item?.title ?? ''}</div>
      </div>
    </div>
  );
}
