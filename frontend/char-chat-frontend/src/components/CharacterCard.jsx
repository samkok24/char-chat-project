import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Skeleton } from './ui/skeleton';
import { Button } from './ui/button';
import { MessageCircle, Heart, Clock } from 'lucide-react';

export const CharacterCard = ({ character, onCardClick, onButtonClick, footerContent }) => {
  const navigate = useNavigate();

  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(character.id);
    } else {
      navigate(`/characters/${character.id}`);
    }
  };

  const handleButtonClick = (e) => {
    e.stopPropagation();
    if (onButtonClick) {
      onButtonClick(character.id, character.chat_room_id);
    } else {
      navigate(`/ws/chat/${character.id}`);
    }
  };

  return (
    <Card 
      className="hover:shadow-lg transition-all duration-200 cursor-pointer group hover:scale-105"
      onClick={handleCardClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start space-x-3">
          <Avatar className="w-12 h-12">
            <LazyLoadImage
              alt={character.name}
              src={character.avatar_url}
              effect="blur"
              className="w-full h-full object-cover rounded-full"
              wrapperClassName="w-full h-full"
            />
            <AvatarFallback className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
              {character.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{character.name}</CardTitle>
            <CardDescription className="text-sm">
              by {character.creator_username || 'Unknown'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-gray-600 mb-4 line-clamp-3">
          {character.description || '설명이 없습니다.'}
        </p>
        
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4 text-sm text-gray-500">
            <div className="flex items-center space-x-1">
              <MessageCircle className="w-4 h-4" />
              <span>{(character.chat_count || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center space-x-1">
              <Heart className="w-4 h-4" />
              <span>{character.like_count || 0}</span>
            </div>
          </div>
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            공개
          </Badge>
        </div>

        {footerContent ? footerContent : (
          <Button
            onClick={handleButtonClick}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 transition-all duration-200"
            size="sm"
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            대화하기
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export const CharacterCardSkeleton = () => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start space-x-3">
          <Skeleton className="w-12 h-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2 mb-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  ); 