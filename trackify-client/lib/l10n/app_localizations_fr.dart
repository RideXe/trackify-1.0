// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get trackingTitle => 'Suivi';

  @override
  String get settingsTitle => 'Paramètres';

  @override
  String get statusTitle => 'Journaux';

  @override
  String get saveButton => 'Enregistrer';

  @override
  String get cancelButton => 'Annuler';

  @override
  String get okButton => 'OK';

  @override
  String get locationButton => 'Envoyer la position';

  @override
  String get statusButton => 'Afficher l\'état';

  @override
  String get settingsButton => 'Modifier les paramètres';

  @override
  String get invalidValue => 'Valeur non valide';

  @override
  String get disabledValue => 'Désactivé';

  @override
  String get idLabel => 'Identifiant de l\'appareil';

  @override
  String get urlLabel => 'URL du serveur';

  @override
  String get accuracyLabel => 'Précision de la localisation';

  @override
  String get highestAccuracyLabel => 'La plus élevée';

  @override
  String get highAccuracyLabel => 'Élevée';

  @override
  String get mediumAccuracyLabel => 'Moyenne';

  @override
  String get lowAccuracyLabel => 'Faible';

  @override
  String get intervalLabel => 'Intervalle (secondes)';

  @override
  String get fastestIntervalLabel => 'Intervalle le plus rapide (secondes)';

  @override
  String get distanceLabel => 'Distance (mètres)';

  @override
  String get angleLabel => 'Angle (degrés)';

  @override
  String get heartbeatLabel => 'Heartbeat à l\'arrêt (secondes)';

  @override
  String get bufferLabel => 'Mise en tampon hors ligne';

  @override
  String get wakelockLabel => 'Maintien éveillé';

  @override
  String get stopDetectionLabel => 'Détection d\'arrêt';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => 'Suivi continu';

  @override
  String get advancedLabel => 'Paramètres avancés';

  @override
  String get passwordLabel => 'Password';

  @override
  String get optimizationMessage =>
      'Pour garantir un suivi fiable, veuillez désactiver l\'optimisation de la batterie pour cette application.';

  @override
  String get passwordError => 'Wrong password';

  @override
  String get startAction => 'Démarrer le service';

  @override
  String get stopAction => 'Arrêter le service';

  @override
  String get sosAction => 'Envoyer un SOS';

  @override
  String get disclosureMessage =>
      'This app collects location and activity data in the background and sends it to the configured server.';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
