import { MessageCircle, MoreVertical, Heart, Edit, Trash2, Users, EyeOff } from 'lucide-react';
import { formatCount } from '../lib/format';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useNavigate, Link } from 'react-router-dom';
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { resolveImageUrl } from '../lib/images';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { useAuth } from '../contexts/AuthContext';

const CharacterInfoHeader = ({ character, likeCount, isLiked, handleLike, isOwner, canTogglePublic = false, onEdit, onDelete, onTogglePublic, isWebNovel = false, workId = null, tags = [] }) => {
  const navigate = useNavigate();
  const { profileVersion } = useAuth();

  return (
    <div className="space-y-4">
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <Heart className="w-4 h-4 text-red-500" fill={isLiked ? 'currentColor' : 'none'} />
            <span>{likeCount.toLocaleString()}</span>
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <MessageCircle className="w-4 h-4" />
            <span>{formatCount(character.chat_count || 0)}</span>
          </div>
        </div>
        {(isOwner || canTogglePublic) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-gray-800 text-white border-gray-700">
              {isOwner && (
                <>
                  <DropdownMenuItem onClick={onEdit}>
                    <Edit className="mr-2 h-4 w-4" /> 수정
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-gray-700" />
                </>
              )}

              {canTogglePublic && (
                <>
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
                </>
              )}

              {isOwner && (
                <DropdownMenuItem onClick={onDelete} className="text-red-500 focus:text-red-400">
                  <Trash2 className="mr-2 h-4 w-4" /> 삭제
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl sm:text-4xl font-bold break-words min-w-0">
          {character.name}
        </h1>
        <Button onClick={handleLike} variant="ghost" size="icon" className="flex-shrink-0">
          <Heart className="w-6 h-6 text-red-500" fill={isLiked ? 'currentColor' : 'none'} />
        </Button>
      </div>

      {/* 원작챗 상세에서는 이름 아래 배지를 표시하지 않음 (이미지 위 배지만 유지) */}
      {!character?.origin_story_id && (
        <div className="flex items-center gap-2">
          {(isWebNovel || character?.source_type === 'IMPORTED') ? (
            <Badge className="bg-blue-600 text-white hover:bg-blue-600">웹소설</Badge>
          ) : (
            <Badge className="bg-purple-600 text-white hover:bg-purple-600">캐릭터</Badge>
          )}
        </div>
      )}

      {character.creator_username && character.creator_id && (
        <div className="mt-1">
          <Link
            to={`/users/${character.creator_id}/creator`}
            className="inline-flex items-center gap-2 text-base sm:text-lg text-gray-300 hover:text-white max-w-full"
          >
            <Avatar className="w-6 h-6">
              <AvatarImage src={resolveImageUrl(character.creator_avatar_url ? `${character.creator_avatar_url}${character.creator_avatar_url.includes('?') ? '&' : '?'}v=${profileVersion}` : '')} alt={character.creator_username} />
              <AvatarFallback className="text-sm">{character.creator_username?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[200px]">{character.creator_username}</span>
          </Link>
        </div>
      )}
      
      {/* 소개 섹션의 하드코딩 문구 제거, 공개일/수정일 노출 */}
      <div className="text-sm text-gray-500 pt-1">
        <span>공개일 {new Date(character.created_at).toLocaleDateString()}</span>
        {' '}|{' '}
        <span>수정일 {new Date(character.updated_at).toLocaleDateString()}</span>
      </div>
      
      {Array.isArray(tags) && tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <Badge key={t.id || t.slug || t.name} variant="secondary" className="bg-gray-700 hover:bg-gray-600 text-white inline-flex items-center gap-1">
              {/* <span>{t.emoji || '🏷️'}</span> */}
              <span>{t.name}</span>
            </Badge>
          ))}
        </div>
      )}
      
      {/* 하단 중복 표시는 제거됨 */}
    </div>
  );
};

export default CharacterInfoHeader; 