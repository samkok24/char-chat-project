import React from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, MessageSquare } from 'lucide-react';

const Footer = ({ compact = false }) => {
  if (compact) {
    return (
      <footer className="bg-transparent border-t border-gray-800/60 mt-6">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between text-sm text-gray-400 gap-3">
          <div className="flex items-center gap-4">
            <Link to="/contact" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-xs sm:text-sm">
              <MessageSquare className="w-4 h-4" />
              1:1 문의
            </Link>
            <Link to="/faq" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-xs sm:text-sm">
              <HelpCircle className="w-4 h-4" />
              FAQ
            </Link>
          </div>
          <p className="text-xs text-gray-500">© 2024 AI 캐릭터 챗.</p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-gray-900 border-t border-gray-800/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
        <div className="text-center md:text-left text-xs sm:text-sm text-gray-500">
          © 2024 AI 캐릭터 챗. All rights reserved.
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-xs sm:text-sm"
          >
            <MessageSquare className="w-4 h-4" />
            1:1 문의
          </Link>
          <span className="text-gray-600">•</span>
          <Link
            to="/faq"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-xs sm:text-sm"
          >
            <HelpCircle className="w-4 h-4" />
            FAQ
          </Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

