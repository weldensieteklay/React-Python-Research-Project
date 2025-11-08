import React from 'react';
import { render, screen, fireEvent} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../src/pages/Dashboard';


jest.mock("../src/context/UserContext", () => ({
    useUser: () => ({
      user: {
        given_name: "Kbret",
        email: "kbret@example.com",
        picture: "profile.jpg",
      },
      handleLogout: jest.fn(),
    }),
  }));
  
  jest.mock("../src/constants/constants", () => ({
    dashboardRoute: [
      { CrossSectionalData: { title: "Cross-Sectional Data", route: "/dashboard/cross-sectional" } },
      { TimeSeriesData: { title: "Time Series Data", route: "/dashboard/time-series" } },
    ],
  }));
describe('Dashboard Component', () => {
  beforeEach(() => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );
  });

  it('renders the Dashboard component', () => {
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('navigates to Cross-Sectional Data on button click', () => {
    const crossSectionalButton = screen.getByText('Cross-Sectional Data');
    fireEvent.click(crossSectionalButton);
    expect(window.location.pathname).toBe('/dashboard/cross-sectional');
  });

  it('navigates to Time Series Data on button click', () => {
    const timeSeriesButton = screen.getByText('Time Series Data');
    fireEvent.click(timeSeriesButton);
    expect(window.location.pathname).toBe('/dashboard/time-series');
  });
});
