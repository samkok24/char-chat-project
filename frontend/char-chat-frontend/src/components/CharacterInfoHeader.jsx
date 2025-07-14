import { Star, MessageCircle, MoreVertical, Heart, Edit, Trash2, Settings, Users, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useNavigate } from 'react-router-dom';
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

const CharacterInfoHeader = ({ character, likeCount, isLiked, handleLike, isOwner, onEdit, onDelete, onSettings, onTogglePublic }) => {
  const navigate = useNavigate();
  const tags = ['스토리', '여성', '여자친구', '다수 인물', '연상', '연하', '판타지', '이세계', '마법사', '자캐', '엘프', '공모전 당선작'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <Heart className={`w-4 h-4 ${isLiked ? 'text-red-500 fill-current' : ''}`} />
            <span>{likeCount.toLocaleString()}</span>
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <MessageCircle className="w-4 h-4" />
            <span>{(character.chat_count || 0).toLocaleString()}k</span>
          </div>
        </div>
        {isOwner && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-gray-800 text-white border-gray-700">
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" /> 수정
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSettings}>
                <Settings className="mr-2 h-4 w-4" /> AI 설정
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-gray-700" />
              <div className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
                {character.is_public ? <Users className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                <Label htmlFor="public-toggle" className="flex-1">
                  {character.is_public ? '공개' : '비공개'}
                </Label>
                <Switch
                  id="public-toggle"
                  checked={character.is_public}
                  onCheckedChange={onTogglePublic}
                  className="ml-auto"
                />
              </div>
              <DropdownMenuSeparator className="bg-gray-700" />
              <DropdownMenuItem onClick={onDelete} className="text-red-500 focus:text-red-400">
                <Trash2 className="mr-2 h-4 w-4" /> 삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4">
            <h1 className="text-4xl font-bold">{character.name}</h1>
            <Star className="w-6 h-6 text-yellow-400 mt-2" />
        </div>
        <Button onClick={handleLike} variant="outline" className={`border-gray-600 ${isLiked ? 'bg-red-500/10 border-red-500 text-red-500' : 'hover:bg-gray-800'}`}>
            <Heart className="w-4 h-4 mr-2" />
            {isLiked ? '좋아요' : '좋아요'}
        </Button>
      </div>

      <p className="text-lg text-gray-300">@{character.creator_username || 'Unknown'}</p>
      
      <p className="text-gray-200">
        여러분은 이세계소환당하면 어떤 삶을 살고 싶으신가요?
      </p>
      
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, index) => (
          <Badge key={index} variant="secondary" className="bg-gray-700 hover:bg-gray-600">
            {tag}
          </Badge>
        ))}
      </div>
      
      <div className="text-sm text-gray-500 pt-2">
        <span>공개일 2025-06-20</span> | <span>수정일 2025-06-30</span>
      </div>
    </div>
  );
};

export default CharacterInfoHeader; 