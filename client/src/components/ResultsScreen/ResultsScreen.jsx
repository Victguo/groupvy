import {
  Avatar,
  Box,
  Button,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material';
import './ResultsScreen.scss';

export default function ResultsScreen({ matches, onRestart }) {
  return (
    <Box component="section" className="screen">
      <Typography className="results-title" variant="h5" gutterBottom>
        Here's what you both liked 🎉
      </Typography>

      <List className="results-list">
        {matches.map((item) => (
          <Paper component={ListItem} className="result-item" key={item.id}>
            <ListItemAvatar>
              {item.poster ? (
                <Avatar
                  variant="rounded"
                  src={item.poster}
                  alt={item.title}
                  sx={{ width: 40, height: 60, borderRadius: '6px' }}
                />
              ) : (
                <Avatar className="r-emoji" variant="rounded" sx={{ bgcolor: 'transparent' }}>
                  {item.emoji}
                </Avatar>
              )}
            </ListItemAvatar>
            <ListItemText
              primary={item.title}
              secondary={item.subtitle}
              primaryTypographyProps={{ fontWeight: 700 }}
              secondaryTypographyProps={{ color: 'text.secondary', fontSize: 13 }}
            />
          </Paper>
        ))}
      </List>

      {matches.length === 0 && (
        <Typography className="no-matches-text" color="text.secondary">
          No overlap this time — happens to the best of us. Try another category!
        </Typography>
      )}

      <Button variant="contained" fullWidth onClick={onRestart}>Start a New Round</Button>
    </Box>
  );
}
