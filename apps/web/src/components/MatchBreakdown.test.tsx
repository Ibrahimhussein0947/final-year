import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComponentBar, ScoreRing } from './MatchBreakdown';

describe('ScoreRing', () => {
  it('exposes the number to screen readers', () => {
    render(<ScoreRing value={72.4} />);
    expect(screen.getByRole('img', { name: 'Match score 72.4 out of 100' })).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });
  it('clamps to 0..100', () => {
    render(<><ScoreRing value={140} label="High" /><ScoreRing value={-5} label="Low" /></>);
    expect(screen.getByRole('img', { name: 'High 100 out of 100' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Low 0 out of 100' })).toBeInTheDocument();
  });
});

describe('ComponentBar', () => {
  it('shows n/a, not 0%, when the component could not be assessed', () => {
    render(<ComponentBar label="Qualification" value={null} />);
    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(screen.queryByText('0%')).toBeNull();
  });
  it('shows the percentage when assessed', () => {
    render(<ComponentBar label="Skills" value={0.835} />);
    expect(screen.getByText('84%')).toBeInTheDocument();
  });
});
