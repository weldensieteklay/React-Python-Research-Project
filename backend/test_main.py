# 1. Update your imports at the top of the file
import pytest
from unittest.mock import patch, MagicMock, ANY  # <-- Add ANY here
from fastapi import Request
from main import verify_google_token

# Helper to create a fake FastAPI Request object
def create_mock_request():
    mock_request = MagicMock(spec=Request)
    mock_request.state = MagicMock()
    return mock_request

@pytest.mark.asyncio
async def test_verify_google_token_success():
    """Test that a valid token parses correctly and mounts to request.state."""
    mock_request = create_mock_request()
    fake_token = "valid.google.jwt.token"
    fake_payload = {"sub": "123456", "email": "user@example.com"}

    # Mock google-auth's verification function to return our fake payload
    with patch("main.id_token.verify_oauth2_token", return_value=fake_payload) as mock_verify:
        result = await verify_google_token(request=mock_request, token=fake_token)
        
        # Assertions
        assert result == fake_payload
        assert mock_request.state.user == fake_payload
        
        # 2. Fix the assertion here by dropping the "patch." prefix
        mock_verify.assert_called_once_with(fake_token, ANY, ANY) 
