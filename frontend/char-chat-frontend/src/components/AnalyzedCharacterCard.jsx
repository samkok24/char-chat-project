import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Save, UserPlus } from 'lucide-react'; // UserPlus 아이콘 추가

const AnalyzedCharacterCard = ({ initialCharacter, onSave, buttonText = "이 캐릭터 저장하기", buttonIcon: ButtonIcon = Save }) => {
  const [character, setCharacter] = useState(initialCharacter);

  useEffect(() => {
    setCharacter(initialCharacter);
  }, [initialCharacter]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCharacter(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    onSave(character);
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <Label htmlFor={`name-${character.name}`}>캐릭터 이름</Label>
        <Input 
          id={`name-${character.name}`}
          name="name" 
          value={character.name} 
          onChange={handleChange} 
          className="text-lg font-bold"
        />
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <div>
          <Label htmlFor={`description-${character.name}`}>한 줄 소개</Label>
          <Textarea 
            id={`description-${character.name}`}
            name="description" 
            value={character.description} 
            onChange={handleChange} 
            rows={3}
          />
        </div>
        <div>
          <Label htmlFor={`social_tendency-${character.name}`}>대인관계 성향 (0-100)</Label>
          <Input 
            id={`social_tendency-${character.name}`}
            name="social_tendency" 
            type="number"
            value={character.social_tendency} 
            onChange={handleChange} 
          />
           <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-2">
            <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${character.social_tendency}%` }}></div>
          </div>
        </div>
      </CardContent>
      <div className="p-4 pt-0">
        <Button className="w-full" onClick={handleSave}>
          <ButtonIcon className="w-4 h-4 mr-2" />
          {buttonText}
        </Button>
      </div>
    </Card>
  );
};

export default AnalyzedCharacterCard; 