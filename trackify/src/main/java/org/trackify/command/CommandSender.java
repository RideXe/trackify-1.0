package org.trackify.command;

import org.trackify.model.Command;
import org.trackify.model.Device;

import java.util.Collection;

public interface CommandSender {
    Collection<String> getSupportedCommands();
    void sendCommand(Device device, Command command) throws Exception;
}
