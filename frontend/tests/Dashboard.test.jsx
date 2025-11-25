import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));


jest.mock("../src/constants/constants", () => ({
  dashboardRoute: [
    { CrossSectionalData: { title: "Cross-Sectional Data", route: "/dashboard/cross-sectional" } },
    { TimeSeriesData: { title: "Time Series Data", route: "/dashboard/time-series" } },
  ],
}));
describe('Dashboard Component', () => {

  it("renders user info and dashboard buttons", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Hello, Kbret")).toBeInTheDocument();
    expect(screen.getByText("kbret@example.com")).toBeInTheDocument();
    expect(screen.getByText("Cross-Sectional Data")).toBeInTheDocument();
    expect(screen.getByText("Time Series Data")).toBeInTheDocument();
  });

  it("navigates to Cross-Sectional Data on button click", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const crossSectionalButton = screen.getByText("Cross-Sectional Data");
    fireEvent.click(crossSectionalButton);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/cross-sectional");
  });

  it("navigates to Time Series Data on button click", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );
  
    const timeSeriesButton = screen.getByText("Time Series Data");
    fireEvent.click(timeSeriesButton);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/time-series");
  });

});


