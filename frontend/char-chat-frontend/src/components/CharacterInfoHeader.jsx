import { MessageCircle, MoreVertical, Heart, Edit, Trash2, Settings, Users, EyeOff } from 'lucide-react';
import { formatCount } from '../lib/format';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useNavigate, Link } from 'react-router-dom';
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

const CharacterInfoHeader = ({ character, likeCount, isLiked, handleLike, isOwner, onEdit, onDelete, onSettings, onTogglePublic, isWebNovel = false, workId = null, tags = [] }) => {
  const navigate = useNavigate();

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
            <span>{formatCount(character.chat_count || 0)}</span>
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
        <h1 className="text-4xl font-bold">{character.name}</h1>
        <Button onClick={handleLike} variant="ghost" size="icon" className={`${isLiked ? 'text-red-500 hover:text-red-500' : ''}`}>
          <Heart className={`w-6 h-6 ${isLiked ? 'fill-current' : ''}`} />
        </Button>
      </div>

      {isWebNovel && (
        <div className="flex items-center gap-2">
          <Badge className="bg-indigo-600 hover:bg-indigo-600">웹소설</Badge>
          {workId && (
            <Button variant="outline" className="border-gray-700 text-gray-200 h-7 px-2" onClick={() => navigate(`/works/${workId}`)}>
              원작 보기
            </Button>
          )}
        </div>
      )}

      {character.creator_username && character.creator_id && (
        <div className="mt-1">
          <Link
            to={`/users/${character.creator_id}/creator`}
            className="inline-flex items-center gap-2 text-lg text-gray-300 hover:text-white"
          >
            <Avatar className="w-6 h-6">
              <AvatarImage src={character.thumbnail_url || character.avatar_url} alt={character.creator_username} />
              <AvatarFallback className="text-sm">{character.creator_username?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[200px]">{character.creator_username}</span>
          </Link>
        </div>
      )}
      
      <p className="text-gray-200">
        여러분은 이세계소환당하면 어떤 삶을 살고 싶으신가요?
      </p>
      
      {Array.isArray(tags) && tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <Badge key={t.id || t.slug || t.name} variant="secondary" className="bg-gray-700 hover:bg-gray-600 inline-flex items-center gap-1">
              <span>{t.emoji || '🏷️'}</span>
              <span>{t.name}</span>
            </Badge>
          ))}
        </div>
      )}
      
      <div className="text-sm text-gray-500 pt-2">
        <span>공개일 2025-06-20</span> | <span>수정일 2025-06-30</span>
      </div>
    </div>
  );
};

export default CharacterInfoHeader; 