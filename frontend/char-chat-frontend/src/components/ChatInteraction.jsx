import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const ChatInteraction = ({ onStartChat }) => {
  return (
    <div className="space-y-4">
      <Select defaultValue="default">
        <SelectTrigger className="w-full bg-gray-800 border-gray-700">
          <SelectValue placeholder="시작할 대화의 상황을 선택하세요" />
        </SelectTrigger>
        <SelectContent className="bg-gray-800 text-white border-gray-700">
          <SelectItem value="default">이세계에 강제 소환하게 된 당신</SelectItem>
          <SelectItem value="option2">다른 상황 선택지 1</SelectItem>
          <SelectItem value="option3">다른 상황 선택지 2</SelectItem>
        </SelectContent>
      </Select>
      <Button
        onClick={onStartChat}
        className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold text-lg py-6"
      >
        새 대화 시작
      </Button>
    </div>
  );
};

export default ChatInteraction; 