package org.trackify.protocol;

import org.junit.jupiter.api.Test;
import org.trackify.ProtocolTest;
import org.trackify.model.Command;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class StartekProtocolEncoderTest extends ProtocolTest {

    @Test
    public void testEncodeEngineStop() throws Exception {

        var encoder = inject(new StartekProtocolEncoder(null));

        Command command = new Command();
        command.setDeviceId(1);
        command.setType(Command.TYPE_ENGINE_STOP);

        assertEquals("$$:24,123456789012345,900,1,19F\r\n", encoder.encodeCommand(null, command));

    }

}
