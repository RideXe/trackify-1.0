// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get trackingTitle => 'Seguimiento';

  @override
  String get settingsTitle => 'Ajustes';

  @override
  String get statusTitle => 'Registros';

  @override
  String get saveButton => 'Guardar';

  @override
  String get cancelButton => 'Cancelar';

  @override
  String get okButton => 'Aceptar';

  @override
  String get locationButton => 'Enviar ubicación';

  @override
  String get statusButton => 'Mostrar estado';

  @override
  String get settingsButton => 'Cambiar ajustes';

  @override
  String get invalidValue => 'Valor no válido';

  @override
  String get disabledValue => 'Deshabilitado';

  @override
  String get idLabel => 'Identificador de dispositivo';

  @override
  String get urlLabel => 'URL del servidor';

  @override
  String get accuracyLabel => 'Precisión de ubicación';

  @override
  String get highestAccuracyLabel => 'Máxima';

  @override
  String get highAccuracyLabel => 'Alta';

  @override
  String get mediumAccuracyLabel => 'Media';

  @override
  String get lowAccuracyLabel => 'Baja';

  @override
  String get intervalLabel => 'Intervalo (segundos)';

  @override
  String get fastestIntervalLabel => 'Intervalo más rápido (segundos)';

  @override
  String get distanceLabel => 'Distancia (metros)';

  @override
  String get angleLabel => 'Ángulo (grados)';

  @override
  String get heartbeatLabel => 'Refresco en reposo (segundos)';

  @override
  String get bufferLabel => 'Búfer sin conexión';

  @override
  String get wakelockLabel => 'Bloqueo de suspensión';

  @override
  String get stopDetectionLabel => 'Detección de parada';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Seguimiento continuo';

  @override
  String get advancedLabel => 'Ajustes avanzados';

  @override
  String get passwordLabel => 'Contraseña';

  @override
  String get optimizationMessage =>
      'Para garantizar un seguimiento fiable, desactive la optimización de batería para esta aplicación.';

  @override
  String get passwordError => 'Contraseña incorrecta';

  @override
  String get startAction => 'Iniciar servicio';

  @override
  String get stopAction => 'Detener servicio';

  @override
  String get sosAction => 'Enviar SOS';

  @override
  String get disclosureMessage =>
      'Esta aplicación recopila datos de ubicación y actividad en segundo plano y los envía al servidor configurado.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
