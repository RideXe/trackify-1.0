import { Text, View } from 'react-native';
import { chooseLanguage, languages, useStrings } from '../i18n';
import { Chip, s as ui } from './ui';

export function LanguagePicker() {
  const { language, t } = useStrings();
  return (
    <View>
      <Text style={ui.label}>{t('language')}</Text>
      <View style={ui.row}>
        {languages.map((option) => (
          <Chip
            key={option.code}
            label={option.label}
            selected={option.code === language}
            onPress={() => void chooseLanguage(option.code)}
          />
        ))}
      </View>
    </View>
  );
}
