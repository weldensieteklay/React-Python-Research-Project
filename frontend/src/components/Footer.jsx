import React from 'react';

const Footer = () => {
  return (
    // z-40: stays above page content (including the map) but below pop-up dialogs (z-50)
    <footer className="bg-[#0071CE] border-t border-sky-700 p-4 text-white text-center fixed bottom-0 w-full z-40">
      <p>&copy; {new Date().getFullYear()} My App. All rights reserved.</p>
    </footer>
  );
};

export default Footer;