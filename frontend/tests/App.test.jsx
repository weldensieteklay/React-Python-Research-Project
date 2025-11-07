import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';


jest.mock('../src/routes/AppRoutes', () => () => <div>Mocked AppRoutes</div>);

describe('App', () => {
  it('renders AppRoutes inside the App component', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText("Mocked AppRoutes")).toBeInTheDocument();
  });
});