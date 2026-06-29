// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Portuguese (`pt`).
class AppLocalizationsPt extends AppLocalizations {
  AppLocalizationsPt([String locale = 'pt']) : super(locale);

  @override
  String get trackingTitle => 'Rastreio';

  @override
  String get settingsTitle => 'Definições';

  @override
  String get statusTitle => 'Registos';

  @override
  String get saveButton => 'Guardar';

  @override
  String get cancelButton => 'Cancelar';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Enviar localização';

  @override
  String get statusButton => 'Mostrar estado';

  @override
  String get settingsButton => 'Alterar definições';

  @override
  String get invalidValue => 'Valor inválido';

  @override
  String get disabledValue => 'Desativado';

  @override
  String get idLabel => 'Identificador do dispositivo';

  @override
  String get urlLabel => 'URL do servidor';

  @override
  String get accuracyLabel => 'Precisão da localização';

  @override
  String get highestAccuracyLabel => 'Máxima';

  @override
  String get highAccuracyLabel => 'Alta';

  @override
  String get mediumAccuracyLabel => 'Média';

  @override
  String get lowAccuracyLabel => 'Baixa';

  @override
  String get intervalLabel => 'Intervalo (segundos)';

  @override
  String get fastestIntervalLabel => 'Intervalo mais rápido (segundos)';

  @override
  String get distanceLabel => 'Distância (metros)';

  @override
  String get angleLabel => 'Ângulo (graus)';

  @override
  String get heartbeatLabel => 'Pulso em repouso (segundos)';

  @override
  String get bufferLabel => 'Armazenamento em buffer offline';

  @override
  String get wakelockLabel => 'Bloqueio de despertar';

  @override
  String get stopDetectionLabel => 'Deteção de paragem';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Rastreio contínuo';

  @override
  String get advancedLabel => 'Definições avançadas';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'Para garantir um rastreio fiável, desative a otimização de bateria para esta aplicação.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'Iniciar serviço';

  @override
  String get stopAction => 'Parar serviço';

  @override
  String get sosAction => 'Enviar SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}

/// The translations for Portuguese, as used in Brazil (`pt_BR`).
class AppLocalizationsPtBr extends AppLocalizationsPt {
  AppLocalizationsPtBr() : super('pt_BR');

  @override
  String get trackingTitle => 'Rastreamento';

  @override
  String get settingsTitle => 'Configurações';

  @override
  String get statusTitle => 'Registros';

  @override
  String get saveButton => 'Salvar';

  @override
  String get cancelButton => 'Cancelar';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Enviar localização';

  @override
  String get statusButton => 'Mostrar status';

  @override
  String get settingsButton => 'Alterar configurações';

  @override
  String get invalidValue => 'Valor inválido';

  @override
  String get disabledValue => 'Desativado';

  @override
  String get idLabel => 'Identificador do dispositivo';

  @override
  String get urlLabel => 'URL do servidor';

  @override
  String get accuracyLabel => 'Precisão da localização';

  @override
  String get highestAccuracyLabel => 'Máxima';

  @override
  String get highAccuracyLabel => 'Alta';

  @override
  String get mediumAccuracyLabel => 'Média';

  @override
  String get lowAccuracyLabel => 'Baixa';

  @override
  String get intervalLabel => 'Intervalo (segundos)';

  @override
  String get fastestIntervalLabel => 'Intervalo mais rápido (segundos)';

  @override
  String get distanceLabel => 'Distância (metros)';

  @override
  String get angleLabel => 'Ângulo (graus)';

  @override
  String get heartbeatLabel => 'Heartbeat estacionário (segundos)';

  @override
  String get bufferLabel => 'Buffer offline';

  @override
  String get wakelockLabel => 'Bloqueio de despertar';

  @override
  String get stopDetectionLabel => 'Detecção de parada';

  @override
  String get trackingLabel => 'Rastreamento contínuo';

  @override
  String get advancedLabel => 'Configurações avançadas';

  @override
  String get passwordLabel => 'Senha';

  @override
  String get optimizationMessage =>
      'Para garantir rastreamento confiável, desative a otimização de bateria para este aplicativo.';

  @override
  String get passwordError => 'Senha errada';

  @override
  String get startAction => 'Iniciar serviço';

  @override
  String get stopAction => 'Parar serviço';

  @override
  String get sosAction => 'Enviar SOS';

  @override
  String get disclosureMessage =>
      'Este aplicativo coleta dados de localização e atividade em segundo plano e os envia para o servidor configurado.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
