import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

const RubyChargeModal = ({ open, onOpenChange }) => {
  return (
    <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-6xl h-[90vh] p-0 overflow-hidden bg-gray-950 border-gray-800">
        <DialogHeader className="px-4 py-3 border-b border-gray-800">
          <DialogTitle className="text-white text-base">루비 충전</DialogTitle>
        </DialogHeader>
        <div className="h-[calc(90vh-57px)] min-h-0">
          <iframe
            title="ruby-charge"
            src="/ruby/charge"
            className="w-full h-full border-0 bg-black"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RubyChargeModal;
