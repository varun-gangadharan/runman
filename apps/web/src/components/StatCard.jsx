import { Card, CardContent, Typography } from '@mui/material';

export default function StatCard({ title, value, unit, subtitle }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography color="text.secondary" variant="body2" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div">
          {value}
          {unit && (
            <Typography component="span" variant="body1" sx={{ ml: 0.75 }} color="text.secondary">
              {unit}
            </Typography>
          )}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
