import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BRAND } from '../theme';

const Footer = () => {
  return (
    // zIndex 1200: stays above page content (including the map) but below pop-up dialogs (1300)
    <Box
      component="footer"
      sx={{ bgcolor: BRAND, borderTop: 1, borderColor: "sky.700", p: 2, color: "common.white", textAlign: "center", position: "fixed", bottom: 0, width: "100%", zIndex: 1200 }}
    >
      <Typography>&copy; {new Date().getFullYear()} AI-Powered Web-Based Data Analysis and Prediction. All rights reserved.</Typography>
    </Box>
  );
};

export default Footer;
