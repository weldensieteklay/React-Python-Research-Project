import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Home from "../src/pages/Home";


const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));


const mockSetUser = jest.fn();
jest.mock("../src/context/UserContext", () => ({
  useUser: () => ({
    setUser: mockSetUser,
  }),
}));


jest.mock("jwt-decode", () => jest.fn(() => ({
  given_name: "Kbret",
  email: "kbret@example.com",
    picture: "profile.jpg",
})));


jest.mock("@react-oauth/google", () => ({
  GoogleLogin: ({ onSuccess, onError }) => (
    <button onClick={() => onSuccess({ credential: "mock-token" })}>
      Mock Google Login
    </button>
  ),
}));

describe("Home Component", () => {
  it("renders welcome message and login prompt", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );

    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Sign in with your Google Account")).toBeInTheDocument();
    expect(screen.getByText("Mock Google Login")).toBeInTheDocument();
  });

  it("handles successful login", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    const loginButton = screen.getByText("Mock Google Login");
    expect(loginButton).toBeInTheDocument();
  });
});
